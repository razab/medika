import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.mjs';

test('Общий голосовой факт: пациент из фразы, прошлое время, повтор, уточнение, отмена и копия',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'medika-global-entry-')),port=14391,origin=`http://127.0.0.1:${port}`;let app,token;
  const start=async dataDir=>{app=await createApp({dataDir,port});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));token=(await(await fetch(origin+'/api/session')).json()).token;};
  const call=async(path,body,status=200)=>{const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
  try{
    await start(join(dir,'data'));const a=await call('/people',{name:'Алиса'},201),d=await call('/people',{name:'Даня'},201),recordedAt=new Date(Date.now()-60000).toISOString();
    const input={text:'Даня, две минуты назад температура 38,2',recordedAt,clientKey:'global-speech-0001',personId:a.id};
    const first=(await call('/record-entry',input,201)).record;assert.equal(first.personId,d.id);assert.equal(first.celsius,38.2);assert.equal(Date.parse(first.occurredAt),Date.parse(recordedAt)-120000);assert.equal((await call('/record-entry',input)).record.id,first.id);
    await call('/record-entry',{...input,text:'Даня температура 39'},409);
    let sequence=0;
    for(const [text,kind,unit] of [['Даня получил таблетку ТестСредство 250 мг пять минут назад','medication','табл.'],['Даня получил свечку ТестСредство 125 мг минуту назад','medication','свеча'],['Даня позывы к рвоте три минуты назад','retching','']]){
      const {record}=await call('/record-entry',{...input,text,clientKey:'global-speech-next-'+(++sequence)},201);
      assert.equal(record.kind,kind);assert.equal(record.unit,unit);assert.equal(record.personId,d.id);if(unit)assert.equal(record.amount,'1');
    }
    const count=(await call('/state')).activities.length;
    for(const text of ['температура 38,2','Даня получил таблетку','Даня температура 38-2','Даня рвота несколько минут назад']){
      const response=await call('/record-entry',{...input,text,clientKey:'needs-review-0001'});assert.equal(response.needsReview,true);assert.ok(!response.record);
    }
    await call('/record-entry',{...input,text:'Даня не получил таблетку ТестСредство'},400);assert.equal((await call('/state')).activities.length,count);
    await call('/activities/'+first.id+'/void',{version:first.version,reason:'Отмена голосовой записи'});await call('/record-entry',input,409);
    const backup=await call('/backup');await app.close();await start(join(dir,'data'));assert.equal((await call('/state')).activities.length,count);
    await app.close();await start(join(dir,'restored'));assert.equal((await call('/restore',backup)).inserted,2+count);assert.equal((await call('/restore',backup)).inserted,0);assert.deepEqual((await call('/state')).activities,backup.activities);
  }finally{await app?.close();await rm(dir,{recursive:true,force:true});}
});
