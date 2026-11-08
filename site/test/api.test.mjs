import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {localParts} from '../lib/domain.mjs';
import {request as httpRequest} from 'node:http';

test('API: источник, изоляция, история, версии, PRN и полная копия',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'medika-api-')),port=14383,app=await createApp({dataDir:directory,port});
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${port}`;
  const token=(await(await fetch(origin+'/api/session')).json()).token;
  const forwarded=(host,publicOrigin,path='/api/state')=>new Promise((resolve,reject)=>{const req=httpRequest(origin+path,{headers:{Host:host,Origin:publicOrigin,'X-Medika-Token':token}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});
  const call=async(path,body,status=200,method=body?'POST':'GET')=>{const r=await fetch(origin+'/api'+path,{method,headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;};
  try{
    assert.equal(await forwarded('medika.localhost','http://medika.localhost','/api/session'),200);
    assert.equal(await forwarded('medika.localhost','http://medika.localhost'),200);
    assert.equal(await forwarded('medika.localhost','http://medika.localhost:4382'),403);
    assert.equal(await forwarded('other.localhost','http://other.localhost','/api/health'),403);
    const anna=await call('/people',{name:'Анна'},201),boris=await call('/people',{name:'Борис'},201);
    const knownAge=await call('/people/'+anna.id,{name:anna.name,displayName:'Имя на доске · тест',ageYears:4,ageAsOf:'2026-11-08',version:anna.version},200,'PUT');assert.equal(knownAge.ageYears,4);assert.equal(knownAge.birthday,'');assert.equal(knownAge.displayName,'Имя на доске · тест');
    const home=await call('/documents',{personId:anna.id,name:'Синтетическая доска',text:'12:00 тестовый препарат 5 мл. План или факт не указан.',sourceKind:'household'},201);assert.deepEqual(home.suggestions,[]);
    const homeEdited=await call('/documents/'+home.id,{reviewNotes:'Время не подтверждает факт приёма',version:home.version},200,'PUT');assert.equal(homeEdited.ocrText,home.text);assert.equal(homeEdited.reviewNotes,'Время не подтверждает факт приёма');
    const end=await call('/course-end',{startDate:'2026-11-08',count:2,unit:'months'});assert.equal(end.endDate,'2027-01-07');
    const doc=await call('/documents',{personId:anna.id,name:'Текст',text:'Ибупрофен 100 мг/5 мл по 2,5 мл'},201);
    const date=localParts(new Date(),'Europe/Chisinau').date;
    const input={personId:anna.id,name:'Ибупрофен',purpose:'Цель со слов врача · тест',dose:'2.5',unit:'мл',strength:'100 мг/5 мл',ingredients:'ибупрофен',startDate:date,type:'daily',times:'08:00',timeZone:'Europe/Chisinau',confirmed:true,documentId:doc.id};
    await call('/prescriptions',{...input,personId:boris.id},400);
    const rx=await call('/prescriptions',input,201),planned=(await call('/schedule?date='+date)).items[0];
    const event=await call('/events',{rxId:rx.id,key:planned.key,date,status:'taken',dose:'2.5'},201);
    assert.equal(planned.purpose,input.purpose);assert.equal(event.purpose,input.purpose);
    await call('/prescriptions/'+rx.id,{...input,purpose:'Изменённая цель · тест',times:'10:00',dose:'3',version:rx.version},200,'PUT');
    const changed=(await call('/schedule?date='+date)).items;
    assert.ok(changed.some(i=>i.historical&&i.event.id===event.id&&i.event.dose==='2.5'&&i.event.purpose===input.purpose));
    await call('/prescriptions/'+rx.id,{...input,version:rx.version},409,'PUT');
    const prn=await call('/prescriptions',{...input,type:'prn',documentId:''},201);
    const record=await call('/events',{rxId:prn.id,date:'2020-01-01',status:'taken'},201);
    assert.equal(record.date,date);
    assert.match(record.time,/^\d\d:\d\d$/);
    await call('/events/'+event.id+'/void',{version:event.version,reason:'Проверка исправления'});
    const state=await call('/state');assert.equal(state.events.find(e=>e.id===event.id).status,'void');
    assert.ok((await call('/audit')).some(a=>a.action==='update:events'));
    const backup=await call('/backup');assert.equal((await call('/restore',backup)).inserted,0);
    await call('/restore',{...backup,prescriptions:[{...backup.prescriptions[0],personId:'bad'}]},400);
    assert.equal((await call('/state')).prescriptions.length,2);
  }finally{await app.close();await rm(directory,{recursive:true,force:true});}
});
