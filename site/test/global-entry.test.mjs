import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.mjs';
import {parseEntry} from '../lib/entry-parser.mjs';

test('Старая голосовая очередь отклоняется до разбора, а сохранённые факты и текстовый ввод доступны',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'medika-global-entry-')),port=14391,origin=`http://127.0.0.1:${port}`;let app,token,parserCalls=0;
  const start=async dataDir=>{app=await createApp({dataDir,port,entryParser:(state,input)=>{parserCalls++;return parseEntry(state,input);}});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));token=(await(await fetch(origin+'/api/session')).json()).token;};
  const call=async(path,body,status=200)=>{const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result;};
  try{
    await start(join(dir,'data'));const a=await call('/people',{name:'Алиса'},201),d=await call('/people',{name:'Даня'},201),recordedAt=new Date(Date.now()-60000).toISOString();
    const input={text:'Даня, две минуты назад температура 38,2',recordedAt,clientKey:'global-speech-0001',personId:a.id};
    const past={personId:a.id,kind:'temperature',celsius:37.2,occurredAt:recordedAt,timeZone:'Europe/Chisinau',clientKey:'legacy-saved-fact-01'};
    const saved=await call('/activities',past,201);
    for(const endpoint of ['/transcribe','/record-entry']){
      await call(endpoint,endpoint==='/transcribe'?{audio:'AAAA',language:'ru'}:input,410);
    }
    assert.equal(parserCalls,0);
    assert.deepEqual((await call('/state')).activities,[saved]);
    const draft=await call('/parse-entry',input);
    assert.equal(draft.personId,d.id);
    assert.equal(draft.celsius,'38.2');
    assert.equal(Date.parse(draft.occurredAt),Date.parse(recordedAt)-120000);
    assert.equal(parserCalls,1);
    const count=(await call('/state')).activities.length;
    assert.equal(count,1);
    const backup=await call('/backup');await app.close();await start(join(dir,'data'));assert.equal((await call('/state')).activities.length,count);
    await app.close();await start(join(dir,'restored'));assert.equal((await call('/restore',backup)).inserted,2+count);assert.equal((await call('/restore',backup)).inserted,0);assert.deepEqual((await call('/state')).activities,backup.activities);
  }finally{await app?.close();await rm(dir,{recursive:true,force:true});}
});
