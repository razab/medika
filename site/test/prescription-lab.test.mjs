import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {complexText,demoContext} from '../lib/lab-fixtures.mjs';
test('OCR lab: приватность, версии, изоляция, ошибочный контекст, атомарный откат и повтор',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'medika-lab-api-')),app=await createApp({dataDir:dir,port:14403});await new Promise(r=>app.server.listen(14403,'127.0.0.1',r));const origin='http://127.0.0.1:14403',token=(await(await fetch(origin+'/api/session')).json()).token;
 const api=async(path,body,status=200,method=body?'POST':'GET',headers={})=>{const r=await fetch(origin+'/api'+path,{method,headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;};
 try{
  assert.equal((await fetch(origin+'/api/ocr-lab')).status,403);await api('/ocr-lab',undefined,403,'GET',{Origin:'https://other.invalid'});
  await api('/ocr-lab/cases',{text:complexText,context:{...demoContext,people:[{...demoContext.people[0],id:'bad" onclick="alert(1)'}]}},400);
  const context=structuredClone(demoContext);for(const p of context.people){const r=await api('/people',{...p,allergies:'Исходная аллергия',notes:'Исходная заметка',color:'blue'},201);p.id=r.id;p.sourceVersion=r.version;}
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBzEAAAAASUVORK5CYII=','base64'),hash=createHash('sha256').update(pixel).digest('hex'),cached=app.store.insert('documents',{personId:context.people[0].id,hash,mime:'image/png',name:'Синтетический кэш OCR',ocrText:'Исходное сохранённое OCR',text:complexText,lines:[],sourceKind:'doctor',suggestions:[]});await writeFile(join(dir,'uploads',cached.id),pixel);const reused=await api('/ocr-lab/cases',{image:pixel.toString('base64'),context},201);assert.equal(reused.ocr.text,'Исходное сохранённое OCR');assert.equal(reused.editedText,complexText);assert.match(reused.ocr.engine,/сохранённый/);
  const fake=await api('/ocr-lab/cases',{synthetic:true,text:complexText,context},201);await api('/ocr-lab/cases/'+fake.id+'/apply',{confirmed:true},400);await api('/ocr-lab/cases/'+fake.id,undefined,200,'DELETE');await api('/ocr-lab/cases/'+fake.id,undefined,404);
  let interval=await api('/ocr-lab/cases',{text:'Test таблетки 10 мг — по 1 таблетке каждые 8 часов, первый приём в 08:00.',context},201);assert.deepEqual(interval.plan.rows[0].preview.map(x=>x.time),['08:00','16:00']);interval=await api('/ocr-lab/cases/'+interval.id,{revision:interval.revision,testDate:'2026-11-10'},200,'PUT');assert.deepEqual(interval.plan.rows[0].preview.map(x=>x.time),['00:00','08:00','16:00']);
  let c=await api('/ocr-lab/cases',{name:'Тест',text:complexText,context},201);const original=c.ocr.text;
  await api('/ocr-lab/cases/'+c.id,{revision:0,variant:2},409,'PUT');await api('/ocr-lab/cases/'+c.id,{revision:c.revision,variant:7},400,'PUT');await api('/ocr-lab/cases/'+c.id+'/apply',{confirmed:true},400);
  const beta=c.plan.parsed.entries.find(x=>x.name==='BetaDrops'),alpha=c.plan.parsed.entries.find(x=>x.name==='AlphaTabs');
  c=await api('/ocr-lab/cases/'+c.id,{revision:c.revision,edits:{choices:{[beta.choiceGroup]:beta.id},people:{[context.people[0].id]:{[alpha.id]:{excluded:true}}}}},200,'PUT');assert.equal(c.plan.ready,7);assert.equal(c.ocr.text,original);
  const before=app.store.state(),insert=app.store.insert;let n=0;app.store.insert=(table,value)=>{if(table==='prescriptions'&&++n===2)throw Error('Injected transaction failure');return insert(table,value);};await api('/ocr-lab/cases/'+c.id+'/apply',{confirmed:true},500);app.store.insert=insert;assert.deepEqual(app.store.state(),before);assert.equal((await readdir(join(dir,'uploads'))).length,1);
  const result=await api('/ocr-lab/cases/'+c.id+'/apply',{confirmed:true});assert.equal(result.inserted,7);assert.ok(app.store.state().people.every(p=>p.allergies==='Исходная аллергия'&&p.notes==='Исходная заметка'&&p.color==='blue'));assert.equal((await api('/ocr-lab/cases/'+c.id+'/apply',{confirmed:true})).inserted,0);
  let overlapping=await api('/ocr-lab/cases',{text:complexText.replace('14 дней','15 дней'),context},201);const alternate=overlapping.plan.parsed.entries.find(x=>x.name==='BetaDrops'),first=overlapping.plan.parsed.entries.find(x=>x.name==='AlphaTabs');overlapping=await api('/ocr-lab/cases/'+overlapping.id,{revision:overlapping.revision,edits:{choices:{[alternate.choiceGroup]:alternate.id},people:{[context.people[0].id]:{[first.id]:{excluded:true}}}}},200,'PUT');const conflict=await api('/ocr-lab/cases/'+overlapping.id+'/apply',{confirmed:true},409);assert.match(conflict.error,/пересекающийся курс/);
  const updated=await api('/ocr-lab/cases/'+c.id,{revision:c.revision,edits:{...c.edits,entries:{[beta.id]:{dose:'6'}}}},200,'PUT');assert.equal(updated.plan.blocked,0);await api('/ocr-lab/cases/'+c.id+'/apply',{confirmed:true},409);
  assert.equal(app.store.state().prescriptions.length,7);
  const prn=await api('/prescriptions',{personId:context.people[0].id,name:'Тест PRN',dose:'1',unit:'мл',type:'prn',startDate:context.startDate,confirmed:true},201);const given=await api('/events',{rxId:prn.id,status:'taken',clientKey:'manual-test-double-click'},201);const again=await api('/events',{rxId:prn.id,status:'taken',clientKey:'manual-test-double-click'});assert.equal(again.id,given.id);await api('/events',{rxId:prn.id,status:'taken',dose:'2',clientKey:'manual-test-double-click'},409);assert.equal(app.store.state().events.length,1);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
