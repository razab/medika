import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from 'node:http';
import {createApp} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=dirname(dirname(fileURLToPath(import.meta.url))),data=await mkdtemp(join(tmpdir(),'medika-concepts-'));
const app=await createApp({dataDir:data,port:14432}),browser=await chromium.launch({headless:true});
const origin='http://127.0.0.1:14432';
const report={synthetic:true,kind:'image concepts, not functional app screens',images:[],viewports:[],auth:false};
await new Promise(resolve=>app.server.listen(14432,'127.0.0.1',resolve));
try{
 for(const id of ['vd1','vd2','vd3']){
  const b=await readFile(join(root,'public/design-study/round-4/'+id+'.png'));
  assert(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  report.images.push({id,width:b.readUInt32BE(16),height:b.readUInt32BE(20),bytes:b.length});
 }
 for(const width of [320,390,768,1024,1600]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{assert(!new URL(r.url()).pathname.startsWith('/api/'));assert.equal(r.method(),'GET');});
  const r=await page.goto(origin+'/design-study/round-4');assert.equal(r.status(),200);assert(r.headers()['content-security-policy'].includes("connect-src 'none'"));
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
  assert.equal(await page.locator('article').count(),3);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const targets=await page.locator('a').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {name:e.textContent.trim()||e.getAttribute('aria-label'),x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};}));
  for(const t of targets)assert(t.width>=48&&t.height>=48,'Small gallery link: '+t.name);
  for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++){
   const a=targets[i],b=targets[j],dx=Math.max(a.x-b.right,b.x-a.right,0),dy=Math.max(a.y-b.bottom,b.y-a.bottom,0);
   assert(Math.hypot(dx,dy)>=7.9,'Adjacent gallery links');
  }
  for(let i=0;i<3;i++){
   await page.locator('article').nth(i).locator('.open').click();assert(page.url().endsWith(`/vd${i+1}.png`));
   const rr=await page.reload();assert.equal(rr.status(),200);assert(rr.headers()['content-type'].includes('image/png'));
   await page.goBack();
  }
  assert.deepEqual(errors,[]);report.viewports.push({width,images:true,links:true,geometry:true});
  if(width===1600){await page.setViewportSize({width:1600,height:1500});await page.screenshot({path:join(root,'public/design-study/round-4/overview.png'),fullPage:true});}
  await page.close();
 }
 const authApp=await createApp({dataDir:join(data,'auth'),port:14433,publicHost:'medika.ibhash.com',requireAccount:true});
 await new Promise(resolve=>authApp.server.listen(14433,'127.0.0.1',resolve));
 try{for(const path of ['/design-study/round-4','/design-study/round-4/vd1.png']){
  const r=await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:14433,path,headers:{Host:'medika.ibhash.com','X-Forwarded-Proto':'https'}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location}));});req.on('error',reject);req.end();});assert.equal(r.status,303);assert(r.location.startsWith('/login'));
 }}finally{await authApp.close();}
 report.auth=true;
 await writeFile(join(root,'../reports/design-round4-result.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{await browser.close();await app.close();await rm(data,{recursive:true,force:true});}
