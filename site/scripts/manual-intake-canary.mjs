import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=await mkdtemp(join(tmpdir(),'medika-manual-intake-'));
const port=14428,origin=`http://127.0.0.1:${port}`;
let app,token,browser;
async function start(folder){
  app=await createApp({dataDir:join(directory,folder),port});
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  token=(await fetch(origin+'/api/session').then(response=>response.json())).token;
}
async function api(path,body,status=200){
  const response=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json();
  assert.equal(response.status,status,JSON.stringify(data));
  return data;
}
try{
  await start('data');
  const patient=await api('/people',{name:'Анна'},201);
  const second=await api('/people',{name:'Максим'},201);
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  page.setDefaultTimeout(12000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const dialog=page.locator('#family-info');
  const form=page.locator('#event-form');
  const panel=page.locator('#family-intake-timers');
  const manual=page.getByRole('button',{name:'Вручную',exact:true});
  const quick=page.locator('[data-add-intake]');
  const editInterval=dialog.getByLabel('Минимальный интервал, ч');
  const medicine='Тестовый препарат';
  const close=()=>dialog.getByRole('button',{name:'Закрыть',exact:true}).tap();
  const directMedication=async who=>{
    await quick.tap();
    if(who)await form.locator('[name=person]').selectOption(who.id);
    assert.equal(await form.locator('[name=kind]').inputValue(),'medication');
    await form.locator('[name=eventName]').fill(medicine);
  };
  await page.goto(origin+'/family');

  for(const [width,height] of [[320,844],[390,844],[768,1024],[1024,768]]){
    await page.setViewportSize({width,height});
    const hit=await manual.boundingBox();
    assert.ok(hit.width>=48&&hit.height>=48);
    const gap=await manual.evaluate(node=>node.getBoundingClientRect().left-node.previousElementSibling.getBoundingClientRect().right);
    assert.ok(gap>=8);
    for(const edge of [2,hit.width/2,hit.width-2]){
      await page.touchscreen.tap(hit.x+edge,hit.y+hit.height/2);
      await form.waitFor();
      assert.equal(await form.locator('[name=kind]').inputValue(),'temperature');
      await close();
    }
    const quickHit=await quick.boundingBox();
    assert.ok(quickHit.width>=48&&quickHit.height>=48);
    const filterGap=await quick.evaluate(node=>node.getBoundingClientRect().top-document.querySelector('.care-family').getBoundingClientRect().bottom);
    assert.ok(filterGap>=8,`quick intake is ${filterGap}px from the family filters`);
    for(const edge of [2,quickHit.width/2,quickHit.width-2]){
      await page.touchscreen.tap(quickHit.x+edge,quickHit.y+quickHit.height/2);
      await dialog.getByRole('heading',{name:'Записать приём',exact:true}).waitFor();
      assert.equal(await form.locator('[name=kind]').inputValue(),'medication');
      assert.equal(await form.locator('select[name=kind]').count(),0);
      assert.equal(await editInterval.inputValue(),'');
      assert.ok(await editInterval.evaluate(node=>node.getBoundingClientRect().height>=48));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await close();
    }
  }
  await page.setViewportSize({width:390,height:844});
  const now=new Date();
  await page.clock.setFixedTime(now);
  await page.locator('.care-family label').filter({hasText:patient.name}).tap();
  await directMedication();
  assert.equal(await form.locator('[name=person]').inputValue(),patient.id);
  await form.locator('[name=amount]').fill('1');
  await form.locator('[name=unit]').selectOption('табл.');
  await editInterval.fill('4');
  await form.locator('[name=when]').selectOption('ago');
  await form.locator('[name=minutes]').fill('30');
  await form.getByRole('button',{name:'Записать',exact:true}).tap();
  await panel.locator('[data-manual-intake-state=waiting]').waitFor();
  assert.match(await panel.innerText(),/Анна.*Тестовый препарат[\s\S]*03:30:00/);
  assert.equal((await api('/state')).prescriptions.length,0);
  const [record]=(await api('/state')).activities;
  assert.equal(record.minHours,'4');
  assert.equal(Date.parse(record.occurredAt),now.getTime()-1800000);
  await page.reload();
  await panel.locator('[data-manual-intake-state=waiting]').waitFor();
  if(process.env.MEDIKA_SCREENSHOT)await page.screenshot({path:process.env.MEDIKA_SCREENSHOT});
  await directMedication(second);
  assert.equal(await editInterval.inputValue(),'');
  await form.locator('[name=person]').selectOption(patient.id);
  assert.equal(await editInterval.inputValue(),'4');
  await close();
  await page.locator('.care-family label').filter({hasText:second.name}).tap();
  assert.equal(await panel.isVisible(),false);
  await page.locator('.care-family label').filter({hasText:patient.name}).tap();
  assert.equal(await panel.isVisible(),true);

  const payload={personId:patient.id,kind:'medication',name:medicine,amount:'1',unit:'табл.',occurredAt:now.toISOString(),timeZone:'Europe/Chisinau',clientKey:'invalid-manual-interval'};
  await api('/activities',{...payload,minHours:'721'},400);
  await api('/activities',{...payload,minHours:'0'},400);
  await api('/activities',{...payload,kind:'other',amount:'',unit:'',minHours:'4'},400);
  const correction=`/activities/${record.id}/correct`;
  const unknown=await api(correction,{version:record.version,timeUnknown:true,occurredAt:null,knownDate:now.toLocaleDateString('sv-SE',{timeZone:'Europe/Chisinau'})});
  await page.reload();
  await panel.locator('[data-manual-intake-state=unknown]').waitFor();
  const returned=await api(correction,{version:unknown.version,occurredAt:record.occurredAt,minHours:'3'});
  const backup=await api('/backup');
  await app.close();
  await start('restored');
  await api('/restore',backup);
  await page.reload();
  await panel.locator('[data-manual-intake-state=waiting]').waitFor();
  assert.match(await panel.innerText(),/02:30:00/);
  await page.clock.setFixedTime(new Date(now.getTime()+3*3600000));
  await panel.locator('[data-manual-intake-state=elapsed]').waitFor();
  await api(`/activities/${record.id}/void`,{version:returned.version,reason:'Проверка отмены'});
  await page.reload();
  await manual.waitFor();
  assert.equal(await panel.isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS manual interval without a schedule, actual time, validation, patient isolation, unknown time, correction, restore, elapsed state and cancellation');
}finally{
  await browser?.close();
  await app?.close();
  await rm(directory,{recursive:true,force:true});
}
