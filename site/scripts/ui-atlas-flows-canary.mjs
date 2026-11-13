import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),dir=await mkdtemp(join(tmpdir(),'atlas-flows-ui-')),port=14428,origin='http://127.0.0.1:'+port,checks=[],errors=[],clinical=[];
let app=await createApp({dataDir:dir,port}),browser;
const start=()=>new Promise(r=>app.server.listen(port,'127.0.0.1',r));
const report=process.env.ATLAS_FLOWS_CANARY_ONLY==='1'?'reports/ui-atlas-flows-smoke.json':'reports/ui-atlas-flows-canary.json';
try{
 await start();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;if(path==='/api/session'||path.startsWith('/api/ui-atlas/'))return route.continue();clinical.push(path);return route.abort();});
 const before=app.store.state(),audit=app.store.history();
 const open=async()=>{await page.goto(origin+'/ui-atlas/flows?check='+Date.now()+'#UF07-A');await page.locator('[data-flow="UF07-A"]').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#flow-text')?.value.includes('В нужном слоте'));};
 const tap=async(n,edge='center')=>{await n.scrollIntoViewIfNeeded();const b=await n.boundingBox();assert(b.width>=48&&b.height>=48,JSON.stringify(b));await page.touchscreen.tap(edge==='left'?b.x+1:edge==='right'?b.x+b.width-1:b.x+b.width/2,b.y+b.height/2);};
 await open();assert.equal(await page.locator('[data-flow]').count(),10);
 const automatic=page.locator('#flow-annotated .flow-tag').filter({hasText:'препарат'}).first();await automatic.click();assert((await page.locator('#tag-details').textContent()).includes('medicines.data'));assert((await page.locator('#tag-details').textContent()).includes('detail'));assert.equal(await page.locator('dialog[open]').count(),0);
 await page.locator('#tag-search').fill('назначение');assert((await page.locator('#tag-options').textContent()).includes('Личное назначение'));await page.locator('[data-tag-ref="data:prescription"]').click();assert((await page.locator('#flow-dirty').textContent()).includes('Не сохранено'));await page.locator('[data-save-flow]').click();await page.waitForFunction(()=>document.querySelector('#flow-heading')?.textContent.includes('версия 2'));assert((await page.locator('#flow-pending-diff').textContent()).includes('Изменения ссылок'));assert.equal(await page.locator('#flow-pending-diff .text-diff').count(),0);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#flow-heading')?.textContent.includes('версия 2'));assert((await page.locator('#flow-annotated .manual').textContent()).includes('Личное назначение'));
 checks.push('Actual word tag → searchable concrete object → tag-only diff v2 → reload persists; no modal');
 const initialText=await page.locator('#flow-text').inputValue(),newText=initialText+' После сохранения выделить новую строку назначения.';
 await page.locator('#flow-text').fill(newText);await page.locator('#flow-note').fill('Сделать результат заметным · синтетическая проверка');await page.locator('[data-save-flow]').click();await page.waitForFunction(()=>document.querySelector('#flow-heading')?.textContent.includes('версия 3'));assert((await page.locator('#flow-pending-diff ins').textContent()).includes('выделить новую строку'));
 await page.locator('[data-request-review]').click();await page.locator('#review-prompt').waitFor();assert((await page.locator('#review-prompt').inputValue()).includes('версии 1 → 3'));
 const download=page.waitForEvent('download');await page.locator('[data-download-review]').click();const d=await download,packet=JSON.parse(await readFile(await d.path(),'utf8'));assert.equal(packet.packet.after.text,newText);assert.equal(packet.packet.before.text,initialText);assert(packet.packet.diff.tags);assert(packet.packet.diff.text);assert(packet.packet.impact.componentIds.includes('prescription-form'));
 await page.locator('[data-version="2"]').click();assert((await page.locator('#flow-version-detail').textContent()).includes('Изменения ссылок'));assert.equal(await page.locator('#flow-text').inputValue(),newText);
 await app.close();app=await createApp({dataDir:dir,port});await start();await open();await page.waitForFunction(()=>document.querySelector('#flow-heading')?.textContent.includes('версия 3'));assert.equal(await page.locator('#flow-text').inputValue(),newText);assert.equal(app.store.state().prescriptions.length,0);
 assert.deepEqual(app.store.state(),before);assert.deepEqual(app.store.history(),audit);assert.equal(app.store.state().events.length,0);
 checks.push('Save text v3 → persisted task with both snapshots/diff/impact → download exact JSON → historical version view → server restart/resume; clinical records unchanged');
 if(process.env.ATLAS_FLOWS_CANARY_ONLY!=='1'){
  for(const [width,height] of [[320,844],[844,390],[768,1024],[1024,768]]){
   await page.setViewportSize({width,height});await open();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   for(const edge of ['left','center','right']){
    const tag=page.locator('#flow-annotated .flow-tag').filter({hasText:'препарат'}).first();await tap(tag,edge);await page.locator('#tag-search').fill('data:medicine');assert.equal(await page.locator('#tag-options [data-tag-ref="data:medicine"]').count(),1);await tap(page.locator('[data-close-picker]'),edge);assert.equal(await page.locator('#tag-picker').isVisible(),false);assert.equal(await page.locator('dialog[open]').count(),0);
   }
   await tap(page.locator('[data-word-mode]'));const word=page.locator('.flow-word').filter({hasText:/^нужном$/}).first();await tap(word);await page.locator('#tag-search').fill('data:slot');await tap(page.locator('[data-tag-ref="data:slot"]'));assert((await page.locator('#tag-details').textContent()).includes('routineSlots'));await tap(page.locator('[data-discard-flow]'));await page.waitForFunction(()=>document.querySelector('#flow-dirty')?.textContent==='Сохранено');
   // Textarea range selection supports phrases and preserves exact UTF-16 offsets.
   await page.locator('#flow-text').evaluate(n=>{n.focus();n.setSelectionRange(0,8);});await tap(page.locator('[data-tag-selection]'));assert((await page.locator('#tag-heading').textContent()).includes(newText.slice(0,8)));await tap(page.locator('[data-close-picker]'));
   const sizes=await page.locator('.flows-layout button,.flows-layout input,.flows-layout a').evaluateAll(ns=>ns.filter(n=>n.getClientRects().length).map(n=>({label:n.textContent||n.id,w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));assert(sizes.every(b=>b.w>=48&&b.h>=48),JSON.stringify(sizes.filter(b=>b.w<48||b.h<48)));
   const gaps=await page.locator('#flow-annotated button').evaluateAll(ns=>{const b=ns.map(n=>n.getBoundingClientRect());let min=Infinity;for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){const x=Math.max(b[i].left-b[j].right,b[j].left-b[i].right,0),y=Math.max(b[i].top-b[j].bottom,b[j].top-b[i].bottom,0);if(x===0||y===0)min=Math.min(min,Math.max(x,y));}return min;});assert(gaps>=8,`tag gap ${gaps}`);
   assert.equal(await page.locator('#flow-message[role=alert]').count(),0);await page.screenshot({path:`reports/ui-atlas-flows-${width}.png`,fullPage:true});checks.push(`${width}×${height}: no horizontal page overflow; tag center/edges; word tagging/search/close; phrase selection; actual targets >=48px and tag gaps >=8px`);
  }
  await open();await page.locator('#flow-text').fill(newText+' Несохранено.');await page.locator('[data-flow="UF01"]').click();assert((await page.locator('#flow-message').textContent()).includes('Сохраните'));await page.locator('[data-discard-flow]').click();await page.waitForFunction(()=>document.querySelector('#flow-dirty')?.textContent==='Сохранено');
  await page.locator('#flow-text').fill(newText+' <img src=x onerror=alert(1)>');assert.equal(await page.locator('#flow-annotated img').count(),0);await page.locator('[data-discard-flow]').click();
  checks.push('Unsaved scenario navigation is blocked with recovery action; user text is escaped');
 }
 assert.deepEqual(clinical,[]);assert.deepEqual(errors,[]);await writeFile(report,JSON.stringify({ok:true,scope:'Synthetic isolated flow definitions; no clinical API access',checks,clinicalCalls:clinical,browserErrors:errors},null,2)+'\n');console.log(JSON.stringify({ok:true,checks}));
}catch(error){await writeFile(report,JSON.stringify({ok:false,checks,error:error.stack,clinical,browserErrors:errors},null,2));throw error;}finally{await browser?.close();await app.close();await rm(dir,{recursive:true,force:true});}
