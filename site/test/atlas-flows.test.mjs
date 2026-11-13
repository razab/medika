import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {autoTags,rebaseManual} from '../../skills/project-ui-atlas/assets/flow-model.js';
import {openAtlasFlows} from '../lib/atlas-flows.mjs';
const seed=JSON.parse(await readFile(new URL('../public/ui-atlas/flows-seed.json',import.meta.url),'utf8'));
const manifest=new URL('../public/ui-atlas/manifest.json',import.meta.url);

test('Flow tags: word boundaries, longest phrase, manual override and edit offsets',()=>{
 const entities=[{id:'medicine',aliases:['лекарство']},{id:'form',aliases:['Добавить лекарство']}];
 const text='Словолекарство: Добавить лекарство. Лекарство.';
 const tags=autoTags(text,entities);assert.deepEqual(tags.map(t=>t.ref),['form','medicine']);
 const manual={start:tags[1].start,end:tags[1].end,ref:null,mode:'manual'};
 assert.equal(autoTags(text,entities,[manual]).at(-1).ref,null);
 const rebased=rebaseManual(text,'Вход: '+text,[manual]);assert.equal(rebased.tags[0].start,manual.start+6);
 assert.equal(rebaseManual(text,text.slice(0,manual.start)+'Другое.',[manual]).dropped,1);
});

test('Flow versions: isolated persistence, stale save, exact tag diff, review packet and completion',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'medika-flow-store-'));let store=openAtlasFlows(dir,seed,manifest);
 try{
  const old=store.list().flows.find(f=>f.id==='UF07-A'),text=old.text+' Новый текст.';
  const v=store.save(old.id,{...old,text,note:'Проверка'});assert.equal(v.revision,2);assert.equal(v.diff.text.before,old.text);assert.equal(v.diff.text.after,text);
  assert.equal(store.save(old.id,{...old,text}).revision,2); // Lost response retry is idempotent.
  assert.throws(()=>store.save(old.id,{...old,text:old.text+' Чужая правка'}),e=>e.status===409);
  const tag=v.tags.find(t=>t.ref==='data:medicine'),tags=v.tags.filter(t=>!(t.start===tag.start&&t.end===tag.end));tags.push({...tag,ref:'data:prescription',mode:'manual'});tags.sort((a,b)=>a.start-b.start);
  const next=store.save(old.id,{...v,tags});assert.equal(next.revision,3);assert(next.diff.tags);assert.equal(next.diff.text,undefined);
  assert.throws(()=>store.save(old.id,{...next,tags:[{start:0,end:999999,ref:'data:medicine',mode:'manual'}]}),e=>e.status===400);
  assert.throws(()=>store.save(old.id,{...next,tags:[{start:0,end:1,ref:'unknown',mode:'manual'}]}),e=>e.status===400);
  const request=store.request(old.id,{revision:3});assert.equal(request.baseRevision,1);assert.equal(request.packet.before.text,old.text);assert.equal(request.packet.after.text,text);assert(request.packet.impact.refs.includes('data:medicine'));assert(request.packet.impact.componentIds.includes('prescription-form'));assert.equal(store.request(old.id,{revision:3}).id,request.id);
  const pending=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/atlas-flows.mjs',import.meta.url)),'pending'],{env:{...process.env,MEDIKA_DATA_DIR:dir},encoding:'utf8'}));assert.equal(pending[0].id,request.id);
  store.close();store=openAtlasFlows(dir,seed,manifest);assert.equal(store.history(old.id).length,3);assert.equal(store.reviews()[0].id,request.id);
  store.complete(request.id,'Изменения проверены на синтетическом стенде');assert.equal(store.list().flows.find(f=>f.id===old.id).reviewedRevision,3);
  const newer=store.save(old.id,{...next,text:text+' Ещё.'});assert.equal(store.packet(old.id).baseRevision,3);assert.equal(newer.revision,4);assert.equal(store.reviews()[0].packet.targetRevision,3);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test('Flow API requires session and same origin, never changes clinical state; survives server restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'medika-flow-api-')),port=14429,origin='http://127.0.0.1:'+port;let app=await createApp({dataDir:dir,port});
 const start=()=>new Promise(r=>app.server.listen(port,'127.0.0.1',r));await start();
 try{
  let token=(await(await fetch(origin+'/api/session')).json()).token;
  const call=async(path='',input,method='GET',extra={})=>fetch(origin+'/api/ui-atlas/flows'+path,{method,headers:{'X-Medika-Token':token,...(input?{'Content-Type':'application/json'}:{}),...extra},...(input?{body:JSON.stringify(input)}:{})});
  assert.equal((await fetch(origin+'/api/ui-atlas/flows')).status,403);
  assert.equal((await fetch(origin+'/ui-atlas/flows',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,200);
  const initial=app.store.state(),audit=app.store.history();
  const state=await(await call()).json(),flow=state.flows[0];assert.equal(state.flows.length,10);
  assert.equal((await call('/'+flow.id,{...flow,text:flow.text+' Тест.'},'PUT',{Origin:'http://foreign.invalid'})).status,403);
  const saved=await(await call('/'+flow.id,{...flow,text:flow.text+' Тест.'},'PUT')).json();assert.equal(saved.revision,2);
  assert.equal((await call('/'+flow.id,{...flow,text:flow.text+' Устаревшая правка'},'PUT')).status,409);
  const task=await(await call('/'+flow.id+'/review',{revision:2},'POST')).json();assert.equal(task.status,'pending');
  assert.deepEqual(app.store.state(),initial);assert.deepEqual(app.store.history(),audit);
  await app.close();app=await createApp({dataDir:dir,port});await start();token=(await(await fetch(origin+'/api/session')).json()).token;
  assert.equal((await(await call('/'+flow.id+'/history')).json()).versions[0].revision,2);assert.equal((await(await call()).json()).reviews[0].id,task.id);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
