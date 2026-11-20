import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from 'node:http';
import {createApp} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const rounds={4:['vd1','vd2','vd3'],5:['d1','d2','d3','l1','l2'],6:['c1','c2','c3'],7:['v1','v2','v3','v4','v5'],8:['s1','s2','s3','s4','s5']};
const round=Object.keys(rounds).map(Number).find(n=>process.argv.includes('--round-'+n))||4;
const allIds=rounds[round];
const ids=process.argv.includes('--first')?allIds.slice(0,1):allIds;
const base='/design-study/round-'+round;
const root=dirname(dirname(fileURLToPath(import.meta.url))),data=await mkdtemp(join(tmpdir(),'medika-concepts-'));
const app=await createApp({dataDir:data,port:14432}),browser=await chromium.launch({headless:true});
const origin='http://127.0.0.1:14432';
const report={synthetic:true,kind:'image concepts, not functional app screens',images:[],viewports:[],auth:false};
await new Promise(resolve=>app.server.listen(14432,'127.0.0.1',resolve));
try{
 for(const id of ids){
  const b=await readFile(join(root,'public'+base+'/'+id+'.png'));
  assert(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  report.images.push({id,width:b.readUInt32BE(16),height:b.readUInt32BE(20),bytes:b.length});
 }
 for(const width of [320,390,768,1024,1600]){
  const page=await browser.newPage({viewport:{width,height:width===768?1024:width===1024?768:1000},hasTouch:true,isMobile:width<=1024}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{assert(!new URL(r.url()).pathname.startsWith('/api/'));assert.equal(r.method(),'GET');});
  const r=await page.goto(origin+base);assert.equal(r.status(),200);assert(r.headers()['content-security-policy'].includes("connect-src 'none'"));
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
  assert.equal(await page.locator('article').count(),ids.length);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const targets=await page.locator('a').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent.trim()||e.getAttribute('aria-label'),x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));
  for(const t of targets)assert(t.width>=48&&t.height>=48,'Small gallery link: '+t.name);
  for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++){
   const a=targets[i],b=targets[j],dx=Math.max(a.x-b.right,b.x-a.right,0),dy=Math.max(a.y-b.bottom,b.y-a.bottom,0);
   assert(Math.hypot(dx,dy)>=7.9,'Adjacent gallery links');
  }
  for(let i=0;i<ids.length;i++){
   await page.locator('article').nth(i).locator('.open').tap();await page.waitForURL(origin+base+'/'+ids[i]+'.png');
   const rr=await page.reload();assert.equal(rr.status(),200);assert(rr.headers()['content-type'].includes('image/png'));
   await page.goBack();
  }
  for(const target of ['.image-link','.open']){
   for(const edge of ['left','right']){
    const link=page.locator('article').first().locator(target);await link.scrollIntoViewIfNeeded();const box=await link.boundingBox();
    await page.touchscreen.tap(edge==='left'?box.x+2:box.x+box.width-2,box.y+box.height/2);
    await page.waitForURL(origin+base+'/'+ids[0]+'.png');await page.goBack();
   }
  }
  assert.deepEqual(errors,[]);report.viewports.push({width,height:page.viewportSize().height,images:true,links:true,geometry:true,touchCentersAndEdges:true});
  if(width===1600){await page.setViewportSize({width:1600,height:1500});await page.screenshot({path:join(root,'public'+base+'/overview.png'),fullPage:true});}
  await page.close();
 }
 const authApp=await createApp({dataDir:join(data,'auth'),port:14433,publicHost:'medika.ibhash.com',requireAccount:true});
 await new Promise(resolve=>authApp.server.listen(14433,'127.0.0.1',resolve));
 try{for(const path of [base,...ids.map(id=>base+'/'+id+'.png')]){
  const r=await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:14433,path,headers:{Host:'medika.ibhash.com','X-Forwarded-Proto':'https'}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location}));});req.on('error',reject);req.end();});assert.equal(r.status,303);assert(r.location.startsWith('/login'));
 }}finally{await authApp.close();}
 report.auth=true;
 await writeFile(join(root,'../reports/design-round'+round+(process.argv.includes('--first')?'-first':'')+'-result.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{await browser.close();await app.close();await rm(data,{recursive:true,force:true});}
