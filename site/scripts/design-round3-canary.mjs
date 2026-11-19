import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {request} from 'node:http';
import {createApp} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=dirname(dirname(fileURLToPath(import.meta.url))),data=await mkdtemp(join(tmpdir(),'medika-round3-'));
const app=await createApp({dataDir:data,port:14430}),browser=await chromium.launch({headless:true});
const first=process.argv.includes('--first'),allVariants=['feed','family','large','sequence','panels'];
const chosen=process.env.MEDIKA_DESIGN_VARIANT;
assert(!chosen||allVariants.includes(chosen));
const variants=chosen?[chosen]:first?['feed']:allVariants;
const sizes=first?[[390,844],[1194,834]]:[[320,740],[390,844],[768,1024],[1024,768],[1194,834]];
const out=join(root,'public/design-study/round-3/previews');
const report={synthetic:true,checks:[],screenshots:[],auth:'pending',clinicalNetwork:'forbidden',physicalDevice:false};
const origin='http://127.0.0.1:14430';
await new Promise(resolve=>app.server.listen(14430,'127.0.0.1',resolve));

async function geometry(page,label){
 const result=await page.locator('button,a').evaluateAll(elements=>{
  const boxes=elements.filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim(),fixed:!!e.closest('.mobile-nav'),...Object.fromEntries(['x','y','width','height','right','bottom'].map(k=>[k,e.getBoundingClientRect()[k]]))}));
  const small=boxes.filter(b=>b.width<47.9||b.height<47.9),close=[];
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
   const a=boxes[i],b=boxes[j];if(a.fixed!==b.fixed)continue;
   const dx=Math.max(a.x-b.right,b.x-a.right,0),dy=Math.max(a.y-b.bottom,b.y-a.bottom,0),gap=Math.hypot(dx,dy);
   if(gap<7.9)close.push([a.label,b.label,Math.round(gap*10)/10]);
  }
  const overflow=[...document.querySelectorAll('body *')].filter(e=>e.clientWidth&&e.scrollWidth>e.clientWidth+2&&!e.classList.contains('family-filter')).map(e=>[e.className,e.clientWidth,e.scrollWidth]).slice(0,12);
  const clipped=elements.filter(e=>e.getClientRects().length&&(e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2)).map(e=>[e.className,e.textContent.trim(),e.clientWidth,e.scrollWidth,e.clientHeight,e.scrollHeight]);
  return {small,close,overflow,clipped,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};
 });
 assert.deepEqual(result.small,[],label+' small');assert.deepEqual(result.close,[],label+' close');assert.deepEqual(result.clipped,[],label+' clipped content');assert(result.scrollWidth<=result.width,label+' overflow '+JSON.stringify(result));
}
async function tab(page,name){await page.locator(`.primary-nav:visible [data-tab="${name}"]`).click();}
async function touch(page,locator,edge){
 await locator.evaluate(el=>el.scrollIntoView({block:'center'}));
 const b=await locator.boundingBox(),x=edge==='left'?b.x+3:edge==='right'?b.x+b.width-3:b.x+b.width/2,y=b.y+b.height/2;
 assert(await locator.evaluate((el,{x,y})=>el.contains(document.elementFromPoint(x,y)),{x,y}),'Occluded touch');
 await page.touchscreen.tap(x,y);
}
try{
 await mkdir(out,{recursive:true});
 for(const variant of variants)for(const [width,height] of sizes)for(const large of [false,true]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{network.push(r.url());assert(!new URL(r.url()).pathname.startsWith('/api/'),'Clinical API requested');assert.equal(r.method(),'GET');});
  const url=origin+`/design-study/round-3/${variant}?capture=1${large?'&text=large':''}`,response=await page.goto(url);
  assert.equal(response.status(),200);assert(response.headers()['content-security-policy'].includes("connect-src 'none'"));
  const label=`${variant} ${width} ${large?'large':'normal'}`;
  assert.equal(await page.locator('.med').count(),11,label);
  assert.equal(await page.locator('.is-taken').count(),2);
  assert((await page.locator('.progress').allTextContents()).every(s=>s.trim()===''),'Daily progress should be dots only');
  assert.equal(await page.locator('[data-row="spray-Обед"] .course-summary').textContent(),'Ещё 5 дней');
  assert.equal(await page.locator('[data-row="capsule-Завтрак"] .course-summary').textContent(),'Курс не указан');
  assert.equal(await page.locator('[data-row="tablet-Ужин"] .course-summary').textContent(),'Последний день');
  if(variant==='large')assert(await page.locator('.full-take').first().evaluate(el=>el.getBoundingClientRect().width>el.closest('.med').getBoundingClientRect().width*.7),'Large action must remain full width');
  assert(await page.locator('main').getByRole('heading',{name:'Обед',exact:true}).count()>0);
  assert(await page.locator('main').getByRole('heading',{name:'Ужин',exact:true}).count()>0);
  await geometry(page,label);
  const take=page.locator('[data-take="spray-Обед"]');
  for(const edge of ['center','left','right']){
   await touch(page,take,edge);assert.equal(await take.getAttribute('aria-pressed'),'true');
   assert.equal(await page.locator('[data-row="spray-Обед"] .progress').getAttribute('aria-label'),'2 из 3 приёмов отмечено');
   assert.equal(await page.locator('[data-row="spray-Обед"] .course-summary').textContent(),'Ещё 5 дней','Marking an intake must not reduce the remaining course days');
   assert.equal(await page.locator('[data-row="spray-Обед"] .rx-detail').count(),0);
   await take.click();assert.equal(await take.getAttribute('aria-pressed'),'false');
  }
  await page.locator('[data-expand="spray-Обед"]').press('Enter');
  assert.equal(await take.getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('[data-row="spray-Обед"] .rx-detail').count(),1);
  await geometry(page,label+' expanded');
  await page.locator('[data-row="spray-Обед"] [data-medicine]').click();
  assert(await page.locator('.medicine-view').isVisible());
  await tab(page,'history');assert.equal(await page.locator('h1').textContent(),'История');
  await tab(page,'medicines');assert(await page.locator('.medicine-view').isVisible());
  await page.locator('[data-drug-back]').click();assert.equal(await page.locator('.catalogue-item').count(),6);
  await tab(page,'history');assert.equal(await page.locator('main .journal-item').count(),2);
  await tab(page,'schedule');assert.equal(await page.locator('[data-row="spray-Обед"] .rx-detail').count(),1);
  await page.locator('[data-expand="spray-Обед"]').click();
  await page.locator('[data-person="danya"]').click();assert.equal(await page.locator('.med').count(),3);
  const other=width===390?1024:390;
  await page.setViewportSize({width:other,height:844});assert.equal(await page.locator('.med').count(),3);
  await page.setViewportSize({width,height});assert.equal(await page.locator('[data-person="danya"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-person="all"]').click();
  await take.click();await page.reload();assert.equal(await page.locator('[data-take="spray-Обед"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(v=>JSON.parse(sessionStorage.getItem('medika-design3:'+v)).some(([key])=>key==='spray-Обед'),variant),true);
  await page.locator('[data-take="second-Завтрак"]').click();assert.equal(await page.locator('[data-row="second-Завтрак"] .interval').count(),0);
  await page.locator('[data-take="second-Завтрак"]').click();assert.equal(await page.locator('[data-row="second-Завтрак"] .interval').count(),1);
  // A passed window must also leave the factual intake action available.
  await page.evaluate(v=>{const a=JSON.parse(sessionStorage.getItem('medika-design3:'+v));a.find(x=>x[0]==='solution-Завтрак')[1]=Date.now()-31*60_000;a.push(['invalid-key',Date.now()]);sessionStorage.setItem('medika-design3:'+v,JSON.stringify(a));},variant);
  await page.reload();assert.equal(await page.locator('[data-timer]').textContent(),'Интервал истёк');
  await page.locator('[data-take="second-Завтрак"]').click();assert.equal(await page.locator('[data-take="second-Завтрак"]').getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>document.querySelector('#reset').click());
  await geometry(page,label+' reset');
  const text200=large&&(width===320||width===1194);
  if(text200){
   await page.evaluate(()=>document.documentElement.style.fontSize='225%');
   await geometry(page,label+' text 200%');
   if(width===320)await page.screenshot({path:join(tmpdir(),'medika-round3-'+variant+'-200.png')});
   const enlargedTake=page.locator('[data-take="spray-Обед"]');
   await touch(page,enlargedTake,'center');assert.equal(await enlargedTake.getAttribute('aria-pressed'),'true');
   await enlargedTake.click();await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));
  }
  await page.evaluate(()=>scrollTo(0,0));
  const size=width===390?(large?'large':'phone'):width===1194&&!large?'tablet':'';
  if(size){const file=variant+'-'+size+'.png';await page.screenshot({path:join(out,file)});const r=await context.request.get(origin+'/design-study/round-3/previews/'+file);assert.equal(r.status(),200);assert(r.headers()['content-type'].includes('image/png'));report.screenshots.push(file);}
  assert.deepEqual(errors,[]);assert(network.length>0);
  report.checks.push({variant,width,height,largeText:large,text200,geometry:true,touch:'center and edges',navigation:true,keyboard:true,resize:true,sessionRestore:true,timerExpiry:true});
  await context.close();
 }
 const page=await browser.newPage({viewport:{width:1800,height:1240}});
 await page.goto(origin+'/design-study/round-3?overview=1');
 assert.equal(await page.locator('.design').count(),5);
 if(!first){
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));await page.screenshot({path:join(out,'overview.png')});
  await page.goto(origin+'/design-study/round-3?overview=1&size=tablet');await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
  await page.setViewportSize({width:1800,height:1100});await page.screenshot({path:join(out,'overview-tablet.png')});
  for(const width of [320,390,768,1024]){
   await page.setViewportSize({width,height:844});await page.goto(origin+'/design-study/round-3');await geometry(page,'gallery '+width);
   for(const name of ['iPhone','iPad','Крупный текст']){await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));}
  }
 }
 await page.close();
 const authApp=await createApp({dataDir:join(data,'auth'),port:14431,publicHost:'medika.ibhash.com',requireAccount:true});
 await new Promise(resolve=>authApp.server.listen(14431,'127.0.0.1',resolve));
 try{for(const path of ['/design-study/round-3','/design-study/round-3/feed','/design-study/round-3/previews/feed-phone.png']){
  const r=await new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:14431,path,headers:{Host:'medika.ibhash.com','X-Forwarded-Proto':'https'}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,location:res.headers.location}));});req.on('error',reject);req.end();});
  assert.equal(r.status,303);assert(r.location.startsWith('/login'));
 }}finally{await authApp.close();}
 report.auth='login required for pages and images';
 if(!first)await writeFile(join(root,'../reports/design-round3-result.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({ok:true,checks:report.checks.length,screenshots:report.screenshots}));
}finally{await browser.close();await app.close();await rm(data,{recursive:true,force:true});}
