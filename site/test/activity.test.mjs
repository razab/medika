import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.mjs';
import {activityInput} from '../lib/domain.mjs';

test('События: собственное название, количество без догадок, время и ключ повтора',()=>{
  const base={personId:'test',kind:'vomiting',occurredAt:new Date(Date.now()-60000).toISOString(),clientKey:'test-entry-123'};
  assert.equal(activityInput(base).name,'Рвота');assert.equal(activityInput(base).amount,'');
  const med=activityInput({...base,kind:'medication',name:'ТестПрепарат',amount:'0,5',unit:'свеча',strength:'Тестовая концентрация'});assert.equal(med.amount,'0.5');assert.equal(med.unit,'свеча');
  for(const change of [{kind:'unknown'},{kind:'inhalation'},{amount:1,unit:'мл'},{kind:'medication',name:'Тест',amount:1},{clientKey:'!'},{occurredAt:new Date(Date.now()+300000).toISOString()}])assert.throws(()=>activityInput({...base,...change}));
});

test('События: повтор запроса, разные эпизоды, отмена, копия v3 и старые версии',async()=>{
  const data=await mkdtemp(join(tmpdir(),'medika-activity-api-')),restored=await mkdtemp(join(tmpdir(),'medika-activity-copy-')),port=14388,origin=`http://127.0.0.1:${port}`;
  let app,token;
  async function start(dataDir){app=await createApp({dataDir,port});await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));token=(await(await fetch(origin+'/api/session')).json()).token;}
  async function call(path,body,status=200,headers={}){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;}
  try{
    await start(data);const a=await call('/people',{name:'Алиса · тест'},201),b=await call('/people',{name:'Даня · тест'},201);
    const base={personId:a.id,kind:'vomiting',occurredAt:new Date(Date.now()-60000).toISOString(),timeZone:'Europe/Chisinau',clientKey:'same-request-123'};
    const first=await call('/activities',base,201);assert.equal((await call('/activities',base)).id,first.id);
    await call('/activities',{...base,personId:b.id},409);await call('/activities',{...base,clientKey:'second-episode-123'},201);
    await call('/activities',{...base,kind:'inhalation',name:'Вода',clientKey:'water-entry-123'},201);
    await call('/activities',{...base,personId:b.id,kind:'medication',name:'ТестПрепарат',amount:'1',unit:'свеча',strength:'Тестовая концентрация',clientKey:'medicine-entry-123'},201);
    await call('/activities',{...base,kind:'other',name:'Другое действие',note:'Примечание',clientKey:'custom-entry-123'},201);
    await call('/temperatures',{personId:a.id,celsius:'38,2',occurredAt:base.occurredAt,timeZone:'Europe/Chisinau'},201);
    await call('/activities',{...base,clientKey:'foreign-site-123'},403,{Origin:'https://example.com'});
    await call('/activities',{...base,personId:'unknown',clientKey:'unknown-person-123'},400);
    await call('/activities/'+first.id+'/void',{reason:'Исправление',version:0},409);
    await call('/activities/'+first.id+'/void',{reason:'Исправление',version:first.version});await call('/activities',base,409);
    const state=await call('/state');assert.equal(state.activities.length,5);assert.equal(state.events.length,0);assert.equal(state.prescriptions.length,0);
    const backup=await call('/backup');assert.equal(backup.version,3);assert.equal((await call('/restore',backup)).inserted,0);
    await call('/restore',{...backup,activities:undefined},400);
    await call('/restore',{...backup,activities:[{...backup.activities[0],kind:'unknown'}]},400);
    await call('/restore',{...backup,activities:[{...backup.activities[0],note:'Конфликт'}]},409);
    const legacy={...backup,version:2};delete legacy.activities;assert.equal((await call('/restore',legacy)).inserted,0);assert.equal((await call('/state')).activities.length,5);
    await app.close();await start(data);assert.equal((await call('/state')).activities.length,5);
    await app.close();await start(restored);assert.equal((await call('/restore',legacy)).inserted,3);assert.equal((await call('/restore',backup)).inserted,5);assert.equal((await call('/restore',backup)).inserted,0);
    assert.deepEqual((await call('/state')).activities,backup.activities);
  }finally{await app?.close();await rm(data,{recursive:true,force:true});await rm(restored,{recursive:true,force:true});}
});
