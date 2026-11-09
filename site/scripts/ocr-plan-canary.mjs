import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.mjs';
import {complexText,demoContext} from '../lib/lab-fixtures.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),directory=await mkdtemp(join(tmpdir(),'medika-ocr-plan-')),dataDir=join(directory,'data'),origin='http://127.0.0.1:14401',checks=[];
let app,browser,token;
async function start(dir=dataDir){app=await createApp({dataDir:dir,port:14401});await new Promise(r=>app.server.listen(14401,'127.0.0.1',r));token=(await(await fetch(origin+'/api/session')).json()).token;}
async function api(path,body,status=200,method=body?'POST':'GET'){const r=await fetch(origin+'/api'+path,{method,headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;}
const check=s=>{checks.push(s);console.log('PASS '+s);};
try{
 await start();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1500,height:1800}});
 await page.setContent('<html lang="ru"><body style="background:white;color:black;padding:45px;font:30px Arial;line-height:1.6"><h1 style="font-size:32px">Синтетическая выписка · тест</h1><div style="white-space:pre-wrap">'+complexText.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</div></body></html>');
 const image=await page.screenshot({fullPage:true});await writeFile('reports/ocr-plan-synthetic.png',image);
 const context=structuredClone(demoContext);for(const person of context.people){const created=await api('/people',person,201);person.id=created.id;person.sourceVersion=created.version;}
 let c=await api('/ocr-lab/cases',{name:'Синтетическая сложная выписка',image:image.toString('base64'),context},201);
 await writeFile('reports/ocr-plan-recognized.json',JSON.stringify({syntheticDataOnly:true,text:c.ocr.text,entries:c.plan.parsed.entries},null,2));
 assert.equal(c.plan.parsed.entries.length,5);assert.equal(c.plan.parsed.choiceGroups.length,1);assert.equal(c.plan.parsed.entries.filter(e=>e.carePhase==='acute').length,2);assert.equal(c.plan.parsed.entries.find(e=>e.name==='AlphaTabs').dose,'0.5');
 check('Сложная картинка → настоящий Apple Vision → две фазы, альтернатива и десятичная доза');
 const parsed=c.plan.parsed,alpha=parsed.entries.find(e=>e.name==='AlphaTabs'),beta=parsed.entries.find(e=>e.name==='BetaDrops');
 const edits={choices:{[beta.choiceGroup]:beta.id},people:{[context.people[0].id]:{[alpha.id]:{excluded:true}}}};
 c=await api('/ocr-lab/cases/'+c.id,{revision:c.revision,edits},200,'PUT');assert.equal(c.plan.ready,7);assert.equal(c.plan.blocked,0);assert.equal(c.plan.unresolvedChoices,0);
 const clinicalBefore=await api('/state'),row=c.plan.rows.find(r=>r.ready&&r.personId===context.people[0].id&&r.entry.name==='BetaDrops');c=await api('/ocr-lab/cases/'+c.id+'/events',{revision:c.revision,rowId:row.id,date:context.startDate,slotIndex:0,status:'taken',phase:'prevention'});assert.deepEqual(await api('/state'),clinicalBefore);
 const savedOCR=c.ocr;await app.close();await start();c=await api('/ocr-lab/cases/'+c.id);assert.deepEqual(c.ocr,savedOCR);assert.equal(c.events.length,1);const duplicate=await api('/ocr-lab/cases',{name:'Тот же снимок',image:image.toString('base64'),context},201);assert.deepEqual(duplicate.ocr,savedOCR);
 check('Два пациента → автоматические разные слоты; лабораторная отметка изолирована; OCR и результат переживают перезапуск и переиспользуются');
 const first=await api('/ocr-lab/cases/'+c.id+'/apply',{confirmed:true});assert.equal(first.inserted,7);assert.equal((await api('/ocr-lab/cases/'+c.id+'/apply',{confirmed:true})).inserted,0);
 let scheduled=await api('/schedule?date='+context.startDate+'&personId='+context.people[0].id);assert.equal(scheduled.items.length,3);assert.ok(scheduled.items.every(r=>r.name==='BetaDrops'));
 const firstSlot=scheduled.items[0];await api('/events',{rxId:firstSlot.rxId,key:firstSlot.key,date:context.startDate,status:'taken'},201);
 let person=(await api('/state')).people.find(p=>p.id===context.people[0].id);await api('/people/'+person.id,{...person,carePhase:'acute'},200,'PUT');scheduled=await api('/schedule?date='+context.startDate+'&personId='+person.id);assert.equal(scheduled.items.filter(i=>!i.historical).length,3);assert.ok(scheduled.items.filter(i=>!i.historical).every(i=>['AcuteMix','DeltaSyrup'].includes(i.name)));assert.equal(scheduled.items.filter(i=>i.historical).length,1);await api('/events',{rxId:firstSlot.rxId,key:firstSlot.key,date:context.startDate,status:'taken'},400);
 const inhalation=scheduled.items.find(r=>!r.historical&&r.name==='AcuteMix');const givenInhalation=await api('/events',{rxId:inhalation.rxId,key:inhalation.key,date:context.startDate,status:'taken'},201);assert.match(givenInhalation.note,/NaCl/);assert.match(givenInhalation.note,/7 мин/);
 const state=await api('/state');assert.equal(state.prescriptions.length,7);assert.equal(state.documents.length,2);assert.ok(state.prescriptions.every(r=>['acute','prevention',''].includes(r.carePhase)));assert.ok(!state.prescriptions.some(r=>r.name==='GammaSpray'));
 const backup=await api('/backup');await writeFile(join(directory,'backup.json'),JSON.stringify(backup));await app.close();await start(join(directory,'restored'));await api('/restore',JSON.parse(await readFile(join(directory,'backup.json'),'utf8')));const restored=await api('/state');assert.deepEqual(restored.people,backup.people);assert.deepEqual(restored.prescriptions,backup.prescriptions);assert.deepEqual(restored.events,backup.events);assert.ok(restored.documents.every(d=>d.planVersion));assert.equal((await api('/restore',backup)).inserted,0);
 check('Один атомарный перенос семи курсов двум людям, защита повтора, реальная смена фаз, отметка кнопкой/API, история и backup/restore');
 await writeFile('reports/ocr-plan-canary.json',JSON.stringify({status:'PASS',checks,syntheticDataOnly:true,physicalDeviceTested:false,completedAt:new Date().toISOString()},null,2));
}catch(error){console.error(error);await writeFile('reports/ocr-plan-canary.json',JSON.stringify({status:'FAIL',checks,error:error.stack,syntheticDataOnly:true},null,2));process.exitCode=1;}
finally{await browser?.close();await app?.close();await rm(directory,{recursive:true,force:true});}
