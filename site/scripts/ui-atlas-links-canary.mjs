import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),directory=await mkdtemp(join(tmpdir(),'atlas-links-')),origin='http://127.0.0.1:14426',checks=[],calls=[],errors=[];
let app,browser;
async function start(){app=await createApp({port:14426,dataDir:directory});await new Promise(r=>app.server.listen(14426,'127.0.0.1',r));}
try{
 await start();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900},hasTouch:true});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{calls.push(route.request().url());return route.abort();});
 const load=async()=>{await page.goto(origin+'/ui-atlas');await page.locator('[data-screen]').first().waitFor();};
 const choose=async(id,edge='center')=>{const button=page.locator('.map [data-action="'+id+'"]');await button.scrollIntoViewIfNeeded();const r=await button.boundingBox();assert(r.width>=48&&r.height>=48);await page.touchscreen.tap(edge==='left'?r.x+1:edge==='right'?r.x+r.width-1:r.x+r.width/2,r.y+r.height/2);};
 async function connection(id,destination){
  assert.equal(await page.locator('.connections>path').count(),1);
  assert.equal(await page.locator('.connections>path').getAttribute('data-connection'),id);
  const label=await page.locator('.map [data-action="'+id+'"]').evaluate(n=>n.firstChild.textContent);
  assert(await page.locator('[data-screen="'+destination+'"]').evaluate(n=>n.classList.contains('destination')));
  const geometry=await page.evaluate(({id,destination})=>{
   const path=document.querySelector('.connections>path'),svg=document.querySelector('.connections').getBoundingClientRect(),button=document.querySelector('.map [data-action="'+id+'"]'),r=button.getBoundingClientRect(),first=path.getPointAtLength(0),last=path.getPointAtLength(path.getTotalLength()),target=document.querySelector('[data-screen="'+destination+'"]').getBoundingClientRect(),source=button.closest('[data-screen]');
   let crossesOtherCard=false;const other=[...document.querySelectorAll('[data-screen]')].filter(n=>n!==source&&n.dataset.screen!==destination).map(n=>n.getBoundingClientRect());
   for(let length=0;length<=path.getTotalLength();length+=4){const p=path.getPointAtLength(length),x=p.x+svg.x,y=p.y+svg.y;if(other.some(n=>x>n.left+1&&x<n.right-1&&y>n.top+1&&y<n.bottom-1))crossesOtherCard=true;}
   return {startsAtButton:Math.min(Math.abs(first.x+svg.x-r.left),Math.abs(first.x+svg.x-r.right))<1&&Math.abs(first.y+svg.y-(r.y+r.height/2))<1,endsAtTarget:Math.abs(last.x+svg.x-(target.x+target.width/2))<1&&Math.abs(last.y+svg.y-(target.top-2))<1,crossesOtherCard};
  },{id,destination});
  assert(geometry.startsAtButton&&geometry.endsAtTarget&&!geometry.crossesOtherCard,JSON.stringify(geometry));assert.equal(await page.locator('.connection-label text').count(),1);assert.equal(await page.locator('.connection-label text').textContent(),label);return {label,...geometry};
 }
 await load();assert.equal(await page.locator('.connections>path').count(),0);assert.match(await page.locator('#flow-description').innerText(),/Выберите действие/);
 await choose('add-from-slot');await connection('add-from-slot','add');assert.match(await page.locator('.connection-label').textContent(),/Добавить/);
 await page.evaluate(()=>scrollTo(0,0));const positions=()=>page.locator('[data-screen]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return [n.dataset.screen,r.x+scrollX,r.y+scrollY,r.width,r.height];}));const before=await positions();await page.getByRole('button',{name:'API и данные',exact:true}).tap();assert.deepEqual(await positions(),before);await connection('add-from-slot','add');await page.getByRole('button',{name:'Дизайн',exact:true}).tap();
 await choose('take');assert.equal(await page.locator('.connections>path').count(),0);assert.equal(await page.locator('.screen.destination').count(),0);assert.match(await page.locator('#flow-description').innerText(),/запись данных/);
 await choose('manual-event');assert.equal(await page.locator('.connections>path').count(),0);assert.match(await page.locator('#flow-description').innerText(),/вне пилота/);
 await page.getByRole('button',{name:'Сбросить',exact:true}).tap();assert.equal(await page.locator('.map .action-list .active').count(),0);assert.equal(await page.locator('.connections>path').count(),0);
 await app.close();await start();await load();assert.equal(await page.locator('.connections>path').count(),0);await choose('save-rx');await connection('save-rx','family');checks.push('Initial map has no unlabelled bundle; one selected action has a labelled connection from its exact button to destination; local/write and out-of-scope actions are explicit without navigation arrows; reset, mode stability, HTTP reload and app restart');
 if(process.env.ATLAS_LINKS_CANARY_ONLY!=='1')for(const [width,height]of [[320,844],[844,390],[768,1024],[1024,768]]){
  await page.setViewportSize({width,height});await load();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const [id,to]of [['add-from-slot','add'],['save-rx','family'],['open-catalog','catalog'],['back-family','family']])for(const edge of ['left','center','right']){await choose(id,edge);await connection(id,to);}
  await page.locator('[data-preview=family]').scrollIntoViewIfNeeded();await page.locator('[data-preview=family]').tap();await page.locator('.hotspot[data-action="add-from-slot"]').tap();await connection('add-from-slot','add');
  const positionsBefore=await positions();await page.getByRole('button',{name:'API и данные',exact:true}).tap();assert.deepEqual(await positions(),positionsBefore);await connection('add-from-slot','add');await page.getByRole('button',{name:'Дизайн',exact:true}).tap();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`reports/ui-atlas-links-synthetic-${width}.png`,fullPage:true});checks.push({width,height,buttonCentersAndEdges:true,oneLabelledConnection:true,noUnrelatedCardCrossing:true,hotspotAndModeSwitch:true});
 }
 assert.deepEqual(calls,[]);assert.deepEqual(errors,[]);await writeFile('reports/ui-atlas-links-canary.json',JSON.stringify({status:'PASS',canaryOnly:process.env.ATLAS_LINKS_CANARY_ONLY==='1',syntheticOnly:true,physicalDeviceTested:false,clinicalApiRequests:0,checks},null,2));console.log('PASS selected, labelled atlas connections from concrete controls');
}catch(error){await writeFile('reports/ui-atlas-links-canary.json',JSON.stringify({status:'FAIL',error:error.message,checks},null,2));throw error;}finally{await browser?.close();await app?.close();await rm(directory,{recursive:true,force:true});}
