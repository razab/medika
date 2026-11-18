import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from 'node:http';
import {createApp} from '../server.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir=await mkdtemp(join(tmpdir(),'medika-round2-'));
const app=await createApp({dataDir,port:14428});
const browser=await chromium.launch({headless:true});
const onlyFirst=process.argv.includes('--first');
const variants=onlyFirst?['calm']:['calm','agenda','people','focus','board'];
const captures=join(root,'public/design-study/round-2/previews');
const report={synthetic:true,variants:[],screenshots:[],network:[],failures:[]};
await new Promise(resolve=>app.server.listen(14428,'127.0.0.1',resolve));
try{
  await mkdir(captures,{recursive:true});
  for(const variant of variants){
    for(const [width,height] of [[320,740],[390,844],[768,1024],[1024,768]]){
      const context=await browser.newContext({viewport:{width,height},hasTouch:true,deviceScaleFactor:1});
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{assert(!new URL(r.url()).pathname.startsWith('/api/'),'Demo contacted clinical API');assert.equal(r.method(),'GET');});
      const response=await page.goto(`http://127.0.0.1:14428/design-study/round-2/${variant}?capture=1`);
      assert.equal(response.status(),200);
      assert(response.headers()['content-security-policy'].includes("connect-src 'none'"));
      await page.evaluate(()=>document.fonts.ready);
      assert.equal(await page.locator('.drug').count(),9);
      assert.equal(await page.locator('.is-taken').count(),2);
      assert.equal(await page.locator('.schedule').getByText('Обед',{exact:true}).count()>0,true);
      assert.equal(await page.locator('.schedule').getByText('Ужин',{exact:true}).count()>0,true);
      const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('body *')].filter(e=>e.scrollWidth>e.clientWidth+1&&e.clientWidth>0).map(e=>[e.className,e.clientWidth,e.scrollWidth]).slice(0,16)}));
      assert(overflow.scroll<=width,`${variant} ${width} page overflow: `+JSON.stringify(overflow));
      const geometry=await page.locator('button,a').evaluateAll(elements=>{
        const boxes=elements.filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim(),...Object.fromEntries(['x','y','width','height','right','bottom'].map(k=>[k,e.getBoundingClientRect()[k]]))}));
        const small=boxes.filter(b=>b.width<47.9||b.height<47.9);
        const close=[];
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
          const a=boxes[i],b=boxes[j],dx=Math.max(a.x-b.right,b.x-a.right,0),dy=Math.max(a.y-b.bottom,b.y-a.bottom,0);
          if(Math.hypot(dx,dy)<7.9)close.push([a.label,b.label,Math.hypot(dx,dy)]);
        }
        return {small,close};
      });
      assert.deepEqual(geometry.small,[],`${variant} ${width} small targets`);
      assert.deepEqual(geometry.close,[],`${variant} ${width} close targets`);
      const take=page.locator('[data-take="spray-Обед"]');
      for(const point of ['center','left','right']){
        await take.scrollIntoViewIfNeeded();
        const b=await take.boundingBox();
        const x=point==='left'?b.x+3:point==='right'?b.x+b.width-3:b.x+b.width/2;
        const y=b.y+b.height/2;
        assert(await page.evaluate(({x,y})=>!!document.elementFromPoint(x,y)?.closest('[data-take="spray-Обед"]'),{x,y}));
        await page.touchscreen.tap(x,y);
        assert.equal(await take.getAttribute('aria-pressed'),'true');
        assert.equal(await page.locator('[data-occurrence="spray-Обед"] .progress').getAttribute('aria-label'),'2 из 3 приёмов отмечено');
        assert.equal(await page.locator('[data-occurrence="spray-Обед"] .drug-detail').count(),0);
        await take.click();assert.equal(await take.getAttribute('aria-pressed'),'false');
      }
      await page.locator('[data-more="spray-Обед"]').click();
      assert.equal(await take.getAttribute('aria-pressed'),'false');
      assert.equal(await page.locator('[data-occurrence="spray-Обед"] .drug-detail').count(),1);
      await page.locator('[data-more="spray-Обед"]').click();
      await page.locator('[data-person="danya"]').click();
      assert.equal(await page.locator('.drug').count(),3);
      await page.locator('[data-person="all"]').click();
      await page.locator('[data-history]').click();
      assert(await page.locator('#history').isVisible());
      await page.locator('[data-back]').click();
      assert.equal(await page.locator('[data-back]').count(),0);
      // Reset through the real control before publishing screenshots.
      await page.evaluate(()=>document.querySelector('#reset').click());
      await page.evaluate(()=>scrollTo(0,0));
      if(width===390||width===1024){
        const file=`${variant}-${width===390?'phone':'tablet'}.png`;
        await page.screenshot({path:join(captures,file)});
        const asset=await context.request.get(`http://127.0.0.1:14428/design-study/round-2/previews/${file}`);
        assert.equal(asset.status(),200);assert(asset.headers()['content-type'].includes('image/png'));
        report.screenshots.push(file);
      }
      assert.deepEqual(errors,[]);
      report.variants.push({variant,width,height,geometry:'passed',touch:'center and edges passed'});
      await context.close();
    }
  }
  const page=await browser.newPage({viewport:{width:1800,height:1300}});
  await page.goto('http://127.0.0.1:14428/design-study/round-2?overview=1');
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.design').count(),5);
  if(!onlyFirst){
    await page.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));
    await page.screenshot({path:join(captures,'overview.png')});
    await page.goto('http://127.0.0.1:14428/design-study/round-2');
    await page.getByRole('button',{name:'iPad',exact:true}).click();
    await page.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));
    assert.equal(await page.locator('body').getAttribute('data-size'),'tablet');
  }
  for(const width of [320,390,768,1024]){
    await page.setViewportSize({width,height:844});
    await page.goto('http://127.0.0.1:14428/design-study/round-2');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await page.locator('a.open').count(),5);
  }
  await page.close();
  const protectedApp=await createApp({dataDir:join(dataDir,'auth'),port:14429,publicHost:'medika.ibhash.com',requireAccount:true});
  await new Promise(resolve=>protectedApp.server.listen(14429,'127.0.0.1',resolve));
  try{
    for(const path of ['/design-study/round-2','/design-study/round-2/calm','/design-study/round-2/previews/calm-phone.png']){
      const r=await new Promise((resolve,reject)=>{
        const req=request({hostname:'127.0.0.1',port:14429,path,headers:{Host:'medika.ibhash.com','X-Forwarded-Proto':'https'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});
        req.on('error',reject);req.end();
      });
      assert.equal(r.status,303,r.body);assert(r.headers.location.startsWith('/login'));
    }
  }finally{await protectedApp.close();}
  console.log(JSON.stringify({ok:true,checks:report.variants.length,screenshots:report.screenshots}));
  if(!onlyFirst)await writeFile(join(root,'../reports/design-round2-result.json'),JSON.stringify(report,null,2)+'\n');
}finally{
  await browser.close();await app.close();await rm(dataDir,{recursive:true,force:true});
}
