import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {emptyRoutine} from '../public/routine.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=await mkdtemp(join(tmpdir(),'medika-routine-')),origin='http://127.0.0.1:14389',date='2026-11-09',checks=[],errors=[];
let app,browser,token;
async function start(dataDir=join(dir,'data')){app=await createApp({dataDir,port:14389});await new Promise(r=>app.server.listen(14389,'127.0.0.1',r));token=(await(await fetch(origin+'/api/session')).json()).token;}
async function api(path,body,status=200,method=body?'POST':'GET'){const res=await fetch(origin+'/api'+path,{method,headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await res.json();assert.equal(res.status,status,JSON.stringify(data));return data;}
const input=r=>({...r,times:(r.times||[]).join(', '),ingredients:(r.ingredients||[]).join(' + ')});
const check=s=>{checks.push(s);console.log('PASS '+s);};
try{
  await start();
  const routine=emptyRoutine();routine.weekday={times:{breakfast:'08:00',dinner:'18:00–19:00'},intakes:['breakfast','dinner','']};routine.weekend={times:{breakfast:'09:00',lunch:'13:00',dinner:'19:00',secondDinner:'21:00'},intakes:['breakfast','lunch','']};
  let alice=await api('/people',{name:'Алиса',routine},201);
  const danyaRoutine=structuredClone(routine);danyaRoutine.weekday.intakes[1]='lunch';danyaRoutine.weekday.times.lunch='13:00';
  const danya=await api('/people',{name:'Даня',routine:danyaRoutine},201);
  const doc=await api('/documents',{personId:alice.id,name:'Синтетическое назначение',sourceKind:'doctor',text:'ТестТаблетка — по 1 табл. 3 раза в день.'},201);
  const base={personId:alice.id,name:'ТестТаблетка',dose:'1',unit:'табл.',startDate:'2026-11-08',endDate:'2026-11-20',timeZone:'Europe/Chisinau',confirmed:true,sourceText:doc.text,documentId:doc.id};
  let rx=await api('/prescriptions',{...base,type:'daily',times:'08:00, 19:00, 23:00'},201);
  const old=(await api('/schedule?date='+date)).items;
  const fact=await api('/events',{rxId:rx.id,date,key:old[0].key,status:'taken'},201);
  rx=await api('/prescriptions/'+rx.id,{...input(rx),type:'routine',legacyTimes:rx.times,routineSlots:[{anchor:'first'},{anchor:'second'},{anchor:'third'}]},200,'PUT');
  const plan=await api('/schedule?date='+date);assert.equal(plan.items.length,3);assert.equal(plan.items.find(i=>i.slotIndex===0).event.id,fact.id);
  await api('/events',{rxId:rx.id,date,key:plan.items.find(i=>i.slotIndex===0).key,status:'taken'},409);
  await api('/prescriptions',{...base,personId:danya.id,documentId:'',type:'routine',routineSlots:[{anchor:'first'},{anchor:'second'},{anchor:'secondDinner',relation:'after'}]},201);
  await api('/prescriptions',{...base,name:'ТестСпрей',type:'routine',routineSlots:[{anchor:'first'},{anchor:'second'},{anchor:'clock',time:'23:15'}]},201);
  await api('/prescriptions',{...base,name:'ТочныеЧасы',type:'daily',times:'17:00'},201);
  check('Документ → активный курс → перенос в распорядок: прежний факт сохранён и не дублируется');
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Chisinau'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByLabel('Дата расписания',{exact:true}).fill(date);await page.locator('[data-anchor="dinner"]').waitFor();
  assert.match(await page.locator('[data-anchor="dinner"]').innerText(),/18:00–19:00/);assert.match(await page.locator('[data-anchor="unassigned"]').innerText(),/3-й приём/);
  assert.match(await page.locator('.patient-schedule').innerText(),/17:00/);
  for(const width of [320,390,768,1024,1470]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(width===390)await page.screenshot({path:'reports/routine-schedule-390.png'});}
  await page.locator('[data-patient="'+danya.id+'"]').click();assert.equal(await page.locator('[data-anchor="lunch"] .schedule-row').count(),1);assert.equal(await page.locator('[data-anchor="secondDinner"] .schedule-row').count(),1);
  await page.locator('[data-patient="'+alice.id+'"]').click();await page.getByRole('button',{name:'Распорядок',exact:true}).click();await page.locator('[name="weekday-dinner-time"]').fill('18:30');await page.locator('[name="weekday-secondDinner-available"]').check();await page.getByRole('button',{name:'Выходные',exact:true}).click();assert.equal(await page.locator('[name="weekend-lunch-time"]').inputValue(),'13:00');await page.locator('dialog').getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});assert.match(await page.locator('[data-anchor="dinner"]').innerText(),/18:30/);
  await page.locator('[data-anchor="unassigned"] [data-act="rx"]').click();await page.locator('#routine-count').fill('4');await page.locator('#routine-count').blur();assert.equal(await page.locator('[data-slot-anchor]').count(),4);await page.getByRole('button',{name:'Закрыть',exact:true}).click();assert.equal((await api('/state')).prescriptions.find(r=>r.id===rx.id).routineSlots.length,3);
  await page.locator('[data-anchor="unassigned"] [data-act="rx"]').click();assert.equal(await page.locator('[data-slot-anchor]').count(),3);assert.equal(await page.locator('[data-slot-offset]').count(),0);assert.doesNotMatch(await page.locator('dialog').innerText(),/Сдвиг|Позже, мин/);await page.locator('[data-slot-anchor="2"]').selectOption('secondDinner');await page.locator('[name="confirmed"]').check();await page.locator('dialog').getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});assert.equal(await page.locator('[data-anchor="unassigned"]').count(),0);assert.equal(await page.locator('[data-anchor="secondDinner"] .schedule-row').count(),1);
  await page.getByLabel('Дата расписания',{exact:true}).fill('2026-11-08');await page.locator('[data-anchor="lunch"]').waitFor();assert.match(await page.locator('[data-anchor="secondDinner"]').innerText(),/21:00/);
  check('Одно тестовое приложение: все группы, будни/выходные, два пациента, точные часы, редактирование, пять размеров экрана');
  rx=(await api('/state')).prescriptions.find(r=>r.id===rx.id);
  const slots=(await api('/schedule?date='+date)).items.filter(i=>i.rxId===rx.id),second=slots.find(i=>i.slotIndex===1);
  const given=await api('/events',{rxId:rx.id,date,key:second.key,status:'taken'},201);
  alice=(await api('/state')).people.find(p=>p.id===alice.id);alice.daySlots.weekday.find(s=>s.id==='dinner').time='19:00';await api('/people/'+alice.id,alice,200,'PUT');
  const next=(await api('/schedule?date='+date)).items.find(i=>i.key===second.key);assert.equal(next.event.id,given.id);assert.equal(next.event.scheduledAt,given.scheduledAt);assert.equal(next.time,'19:00');await api('/events',{rxId:rx.id,date,key:second.key,status:'taken'},409);
  const unclocked=(await api('/schedule?date='+date)).items.find(i=>i.rxId===rx.id&&i.anchor==='secondDinner');assert.equal(unclocked.scheduledAt,undefined);await api('/events',{rxId:rx.id,date,key:unclocked.key,status:'taken'},201);
  const backup=await api('/backup');await writeFile(join(dir,'backup.json'),JSON.stringify(backup));await app.close();await start();assert.equal((await api('/state')).events.length,3);
  await app.close();await start(join(dir,'restore'));await api('/restore',JSON.parse(await readFile(join(dir,'backup.json'),'utf8')));const restored=await api('/state');assert.equal(restored.events.length,3);assert.deepEqual(restored.events,backup.events);assert.deepEqual(restored.people,backup.people);assert.deepEqual(restored.prescriptions,backup.prescriptions);assert.equal((await api('/restore',backup)).inserted,0);
  await page.reload();await page.getByLabel('Дата расписания',{exact:true}).fill(date);await page.locator('[data-anchor="dinner"]').waitFor();assert.match(await page.locator('[data-anchor="dinner"]').innerText(),/Дано в/);assert.deepEqual(errors,[]);
  check('Новые и старые факты, перенос часов, факт без точного часа, запрет дубля, перезапуск и backup/restore без потерь');
  await writeFile('reports/routine-canary.json',JSON.stringify({status:'PASS',checks,syntheticDataOnly:true,physicalDeviceTested:false,completedAt:new Date().toISOString()},null,2));
}catch(e){console.error(e);await writeFile('reports/routine-canary.json',JSON.stringify({status:'FAIL',checks,error:e.stack,errors,syntheticDataOnly:true},null,2));process.exitCode=1;}
finally{await browser?.close();await app?.close();await rm(dir,{recursive:true,force:true});}
