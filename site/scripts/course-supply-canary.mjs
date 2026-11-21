import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {nextDay} from '../lib/domain.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=await mkdtemp(join(tmpdir(),'medika-course-'));
const port=14424,origin=`http://127.0.0.1:${port}`;
let app,browser,token;
async function start(){
  app=await createApp({dataDir:join(directory,'data'),port});
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  token=(await (await fetch(origin+'/api/session')).json()).token;
}
async function api(path,body,method=body?'POST':'GET'){
  const response=await fetch(origin+'/api'+path,{method,headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();
  assert.ok(response.ok,JSON.stringify(value));
  return value;
}
try{
  await start();
  const date=(await api('/family')).model.date;
  const people=[];
  for(const name of ['Тест Первый','Тест Второй'])people.push(await api('/people',{name,carePhase:'acute'}));
  const medicine=await api('/medicines',{name:'ТестТаблетки',medicineForm:'tablet',strength:'100 mg'});
  const base={medicineId:medicine.id,medicineVersion:medicine.version,name:medicine.name,medicineForm:'tablet',strength:'100 mg',unit:'табл.',type:'routine',routineSlots:[{anchor:'breakfast'},{anchor:'dinner'}],startDate:date,endDate:nextDay(date,2),confirmed:true,minHours:'12',timeZone:'Europe/Chisinau'};
  const first=await api('/prescriptions',{...base,personId:people[0].id,dose:'0.5'});
  await api('/prescriptions',{...base,personId:people[1].id,dose:'1'});
  let view=await api('/family');
  assert.equal(view.courseSupply[0].total,9);
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  page.setDefaultTimeout(12000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const settled=()=>page.waitForFunction(()=>document.querySelector('#family')?.getAttribute('aria-busy')==='false');
  const close=()=>page.getByRole('button',{name:'Закрыть',exact:true}).tap();
  await page.goto(origin+'/family');
  await page.locator('.family-intake-progress').first().waitFor();
  assert.equal(await page.locator('.family-intake-progress').first().getAttribute('aria-label'),'Принято 0 из 2 за день расписания');
  await page.locator('.family-supply>summary').tap();
  assert.match(await page.locator('.family-supply').innerText(),/Всего нужно 9 табл/);
  const row=view.plans.find(r=>r.prescriptionId===first.id);
  const item=page.locator(`[data-demo-row="${row.key}"]`);
  await item.locator('.care-take').tap();
  await settled();
  assert.equal((await api('/family')).courseSupply[0].total,8.5);
  const timer=item.locator('[data-intake-row]');
  await timer.waitFor({state:'visible'});
  assert.match(await timer.innerText(),/До следующего приёма/);
  assert.equal(await item.locator('.family-intake-dot').count(),2);
  assert.equal(await item.locator('.family-intake-dot.is-taken').count(),1);
  assert.equal(await page.locator(`[data-person="${people[1].id}"] .family-intake-dot.is-taken`).count(),0);
  await item.locator('.care-take').tap();
  await settled();
  assert.equal(await item.locator('.family-intake-dot.is-taken').count(),0);
  await item.locator('.care-take').tap();
  await settled();
  const restoredFact=(await api('/state')).events.find(event=>event.status==='taken');
  await item.locator('summary').tap();
  await item.getByRole('button',{name:'Изменить назначение',exact:true}).tap();
  await page.getByLabel('Сколько раз в день',{exact:true}).selectOption('3');
  assert.equal(await page.locator('[data-rx-occurrence]').count(),3);
  await page.locator('[name=rxAnchor2]').selectOption('lunch');
  await page.getByLabel('Минимальный интервал, ч',{exact:true}).fill('6');
  await page.getByRole('button',{name:'Сохранить',exact:true}).tap();
  await settled();
  await page.locator('#family-info').waitFor({state:'hidden'});
  assert.match(await item.locator('.family-intake-progress').getAttribute('aria-label'),/1 из 3/);
  assert.equal((await api('/state')).events[0].id,restoredFact.id);
  assert.equal(await item.locator('.family-intake-dot').count(),3);
  assert.equal(await item.locator('.family-intake-dot.is-taken').count(),1);
  await page.reload();
  await page.locator('.family-intake-progress').first().waitFor();
  await page.screenshot({path:'reports/daily-intake-progress-synthetic.png'});
  await item.locator('summary').tap();
  await item.getByRole('button',{name:'Изменить назначение',exact:true}).tap();
  await page.getByLabel('Сколько раз в день',{exact:true}).selectOption('2');
  await page.getByRole('button',{name:'Сохранить',exact:true}).tap();
  await settled();
  await page.locator('#family-info').waitFor({state:'hidden'});
  assert.equal((await api('/family')).courseSupply[0].total,8.5);
  await page.reload();
  await page.locator('.family-intake-progress').first().waitFor();
  assert.match(await timer.innerText(),/Интервал 6 ч/);

  await page.getByRole('button',{name:'Ещё',exact:true}).tap();
  await page.getByRole('button',{name:'Добавить в расписание',exact:true}).tap();
  await page.locator('#add-medicine-form [name=personId]').selectOption(people[0].id);
  await page.locator('#add-medicine-form [name=medicineId]').selectOption(medicine.id);
  await page.getByLabel('Разовая доза',{exact:true}).fill('1');
  await page.getByLabel('Сколько раз в день',{exact:true}).selectOption('2');
  assert.equal(await page.locator('[name=slot]:checked').count(),2);
  await page.getByRole('radio',{name:'Точное время',exact:true}).check();
  assert.equal(await page.locator('#add-medicine-clock input,[data-extra-clock] input').count(),2);
  await page.locator('[name=clockTime]').fill('07:00');
  await page.locator('[name=clockTime1]').fill('19:00');
  await page.getByLabel('Минимальный интервал, ч',{exact:true}).fill('12');
  await page.getByRole('button',{name:'Добавить в расписание',exact:true}).tap();
  await page.locator('#family-info').waitFor({state:'hidden'});
  const created=(await api('/state')).prescriptions.at(-1);
  assert.deepEqual(created.routineSlots.map(slot=>slot.time),['07:00','19:00']);
  assert.equal(created.minHours,'12');

  for(const [width,height] of [[320,844],[844,390],[768,1024],[1024,768]]){
    await page.setViewportSize({width,height});
    await page.reload();
    await page.locator('.family-intake-progress').first().waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const summary=page.locator('.family-supply>summary');
    for(const edge of ['left','center','right']){
      await summary.scrollIntoViewIfNeeded();
      const rect=await summary.boundingBox();
      assert.ok(rect.width>=48&&rect.height>=48);
      await page.touchscreen.tap(edge==='left'?rect.x+2:edge==='right'?rect.x+rect.width-2:rect.x+rect.width/2,rect.y+rect.height/2);
    }
    await item.locator('summary').tap();
    await item.getByRole('button',{name:'Изменить назначение',exact:true}).tap();
    for(const name of ['dailyFrequency','minHours','maxPer24h']){
      const field=page.locator(`#rx-form [name=${name}]`);
      await field.scrollIntoViewIfNeeded();
      const rect=await field.boundingBox();
      assert.ok(rect.width>=48&&rect.height>=48);
      for(const edge of ['left','center','right']){
        await field.scrollIntoViewIfNeeded();
        const current=await field.boundingBox();
        await page.touchscreen.tap(edge==='left'?current.x+2:edge==='right'?current.x+current.width-2:current.x+current.width/2,current.y+current.height/2);
        assert.equal(await field.evaluate(input=>input===document.activeElement),true,JSON.stringify({width,height,name,edge,current}));
        if(name==='dailyFrequency')await page.keyboard.press('Tab');
      }
    }
    const fields=await page.locator('#rx-form input:visible,#rx-form select:visible,#rx-form button:visible').evaluateAll(inputs=>inputs.map(input=>{
      const rect=input.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height};
    }));
    for(const [index,rect] of fields.entries())for(const other of fields.slice(index+1)){
      const x=Math.max(rect.x-other.x-other.width,other.x-rect.x-rect.width);
      const y=Math.max(rect.y-other.y-other.height,other.y-rect.y-rect.height);
      assert.ok(x>=7.9||y>=7.9,JSON.stringify({rect,other}));
    }
    await close();
  }
  await page.setViewportSize({width:1024,height:900});
  await page.reload();
  await page.locator('.family-intake-progress').first().waitFor();
  await page.locator('.family-supply>summary').tap();
  await page.locator('.family-supply').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({path:'reports/course-supply-synthetic.png'});
  const backup=await api('/backup');
  await app.close();
  await start();
  assert.deepEqual((await api('/state')).prescriptions,backup.prescriptions);
  assert.equal((await api('/family')).courseSupply[0].total,8.5);
  assert.deepEqual(errors,[]);
  await writeFile('reports/course-supply-canary.json',JSON.stringify({status:'PASS',syntheticOnly:true,physicalDeviceTested:false,frequency:true,remainingForFamily:true,actualIntakeTimer:true,restart:true},null,2));
  console.log('PASS frequency, combined supply, actual intake interval, edit, clocks, touch targets and restart');
}finally{
  await browser?.close();
  await app?.close();
  await rm(directory,{recursive:true,force:true});
}
