import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.mjs';
import {temperatureInput} from '../lib/domain.mjs';

test('Температура: десятичная запятая, границы, дата, будущее и часовой пояс',()=>{
  const base={personId:'test',celsius:'38,2',occurredAt:new Date(Date.now()-60000).toISOString(),timeZone:'Europe/Chisinau'};
  assert.equal(temperatureInput(base).celsius,38.2);
  for(const value of [20,50,'36.65'])assert.equal(temperatureInput({...base,celsius:value}).celsius,Number(value));
  for(const value of ['',null,19.99,50.01,'382','NaN','38.222',true])assert.throws(()=>temperatureInput({...base,celsius:value}));
  for(const occurredAt of ['2026-02-30T12:00:00Z','2026-02-01T12:00',new Date(Date.now()+300000).toISOString()])assert.throws(()=>temperatureInput({...base,occurredAt}));
  assert.throws(()=>temperatureInput({...base,timeZone:'Invalid/Zone'}));
});

test('Температура: отдельные факты, история отмены, перезапуск и копии v1/v2',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'medika-temperature-api-')),restored=await mkdtemp(join(tmpdir(),'medika-temperature-restored-')),port=14386,origin=`http://127.0.0.1:${port}`;
  let app,token;
  async function start(dataDir){app=await createApp({dataDir,port});await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));token=(await(await fetch(origin+'/api/session')).json()).token;}
  async function call(path,body,status=200,headers={}){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;}
  try{
    await start(directory);
    const a=await call('/people',{name:'Алиса · тест'},201),b=await call('/people',{name:'Даня · тест'},201);
    const base={personId:a.id,celsius:'38,2',occurredAt:new Date(Date.now()-60000).toISOString(),timeZone:'Europe/Chisinau'};
    const latest=await call('/temperatures',base,201);
    await call('/temperatures',{...base,celsius:'37,4',occurredAt:new Date(Date.now()-3600000).toISOString()},201);
    await call('/temperatures',{...base,personId:b.id,celsius:'36,8'},201);
    assert.equal(latest.celsius,38.2);assert.equal(latest.status,'recorded');assert.ok(!latest.rxId);
    const state=await call('/state');assert.equal(state.prescriptions.length,0);assert.equal(state.events.length,0);assert.equal(state.temperatures.filter(t=>t.personId===a.id).length,2);
    await call('/temperatures',{...base,personId:'unknown'},400);
    await call('/temperatures',{...base,occurredAt:new Date(Date.now()+300000).toISOString()},400);
    await call('/temperatures',base,403,{Origin:'https://example.com'});
    await call('/temperatures/'+latest.id+'/void',{reason:'Тест исправления',version:0},409);
    await call('/temperatures/'+latest.id+'/void',{reason:'Тест исправления',version:latest.version});
    await call('/temperatures/'+latest.id+'/void',{reason:'Повтор',version:latest.version},409);
    assert.ok((await call('/audit')).some(a=>a.action==='update:temperatures'));
    const backup=await call('/backup');assert.equal(backup.version,3);assert.equal(backup.temperatures.length,3);
    assert.equal((await call('/restore',backup)).inserted,0);
    await call('/restore',{...backup,temperatures:undefined},400);
    await call('/restore',{...backup,temperatures:[{...backup.temperatures[0],personId:'unknown'}]},400);
    await call('/restore',{...backup,temperatures:[{...backup.temperatures[0],celsius:39}]},409);
    const legacy={...backup,version:1};delete legacy.temperatures;assert.equal((await call('/restore',legacy)).inserted,0);assert.equal((await call('/state')).temperatures.length,3);
    await app.close();await start(directory);assert.equal((await call('/state')).temperatures.length,3);
    await app.close();await start(restored);assert.equal((await call('/restore',legacy)).inserted,2);assert.equal((await call('/state')).temperatures.length,0);
    assert.equal((await call('/restore',backup)).inserted,3);assert.equal((await call('/restore',backup)).inserted,0);
    assert.deepEqual((await call('/state')).temperatures,backup.temperatures);
  }finally{await app?.close();await rm(directory,{recursive:true,force:true});await rm(restored,{recursive:true,force:true});}
});
