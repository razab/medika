import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {nextDay} from '../lib/domain.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const directory=await mkdtemp(join(tmpdir(),'medika-readable-'));
const port=14426,origin=`http://127.0.0.1:${port}`,checks=[];
let app,browser,token;
async function api(path,body){
  const response=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  assert.ok(response.ok,JSON.stringify(data));
  return data;
}
try{
  app=await createApp({dataDir:directory,port});
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  token=(await (await fetch(origin+'/api/session')).json()).token;
  const date=(await api('/family')).model.date;
  const person=await api('/people',{name:'Тест Первый',carePhase:'acute'});
  const other=await api('/people',{name:'Тест Второй',carePhase:'acute'});
  const medicine=await api('/medicines',{name:'Тестовое средство с длинным названием',medicineForm:'tablet',strength:'100 mg'});
  const second=await api('/medicines',{name:'ТестВторойПрепарат',medicineForm:'inhalation',strength:'1 mg/ml',afterMedicine:{medicineId:medicine.id,minMinutes:15,maxMinutes:30}});
  const prescription={medicineId:medicine.id,medicineVersion:medicine.version,name:medicine.name,medicineForm:'tablet',strength:medicine.strength,dose:'1',unit:'табл.',type:'routine',routineSlots:[{anchor:'breakfast'},{anchor:'lunch'},{anchor:'dinner'}],startDate:date,endDate:nextDay(date,2),confirmed:true,timeZone:'Europe/Chisinau',minHours:'8'};
  const rx=await api('/prescriptions',{...prescription,personId:person.id});
  await api('/prescriptions',{...prescription,personId:other.id});
  await api('/prescriptions',{...prescription,personId:person.id,medicineId:second.id,medicineVersion:second.version,name:second.name,medicineForm:'inhalation',strength:second.strength,unit:'мл',routineSlots:[{anchor:'breakfast'}],minHours:''});
  const row=(await api('/family')).plans.find(item=>item.prescriptionId===rx.id);
  await api('/events',{rxId:rx.id,rxVersion:rx.version,key:row.key,date,status:'taken',occurredAt:new Date(Date.now()-20*60000).toISOString()});
  await api('/activities',{personId:person.id,kind:'temperature',celsius:'37.7',occurredAt:new Date().toISOString(),timeZone:'Europe/Chisinau',clientKey:'readability-temperature'});
  browser=await chromium.launch({headless:true,args:['--mute-audio']});
  const page=await browser.newPage({hasTouch:true,viewport:{width:390,height:844}});
  page.setDefaultTimeout(12000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const settled=()=>page.waitForFunction(()=>document.querySelector('#family')?.getAttribute('aria-busy')==='false');
  const measureContrast=()=>page.evaluate(()=>{
      const luminance=rgb=>rgb.slice(0,3).map(channel=>{const value=channel/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
      const rgb=color=>color.match(/[\d.]+/g).map(Number);
      return ['.care-med-name','.family-medicine-group','.family-intake-timer','.family-phase-status','.family-course','.family-tabs button','#family-timers [data-timer-state]'].map(selector=>{
        const node=document.querySelector(selector),foreground=luminance(rgb(getComputedStyle(node).color));
        let parent=node,background=[255,255,255];
        while(parent){const color=rgb(getComputedStyle(parent).backgroundColor);if(color.length===3||color[3]===1){background=color;break;}parent=parent.parentElement;}
        const back=luminance(background);
        return {selector,ratio:(Math.max(foreground,back)+.05)/(Math.min(foreground,back)+.05)};
      });
    });
  const footer=page.locator('.family-preview-footer');
  const item=page.locator(`[data-demo-row="${row.key}"]`);
  for(const [width,height] of [[320,844],[390,844],[844,390],[768,1024],[1024,768]]){
    await page.setViewportSize({width,height});
    await page.goto(origin+'/family');
    await page.locator('.family-intake-progress').first().waitFor();
    await settled();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await footer.getByRole('link',{name:'История',exact:true}).isVisible());
    const typography=await page.evaluate(()=>Object.fromEntries([
      ['.care-med-name',22],['.care-dose',22],['.care-person-head h2',24],['.family-medicine-group',16],
      ['.family-phase-status',16],['.family-intake-timer',18],['.family-course',16],['.family-tabs button',14]
    ].map(([selector,minimum])=>[selector,{actual:parseFloat(getComputedStyle(document.querySelector(selector)).fontSize),minimum}])));
    for(const [selector,value] of Object.entries(typography))assert.ok(value.actual>=value.minimum,JSON.stringify({width,selector,...value}));
    assert.equal(await page.locator('#family-timers [data-timer-state]').count(),1);
    assert.match(await page.locator('#family-timers').innerText(),/Интервал 15–30 мин|До второго препарата/);
    if(!checks.length)assert.equal(await page.locator('#family-timers [data-timer-state=ready]').count(),1);
    const contrast=await measureContrast();
    for(const value of contrast)assert.ok(value.ratio>=4.5,JSON.stringify({width,...value}));
    const controls=await footer.locator('.family-tabs > *').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));
    assert.ok(controls.every(rect=>rect.width>=48&&rect.height>=48));
    assert.ok(controls.slice(1).every((rect,index)=>rect.left-controls[index].right>=8));
    assert.equal(await footer.locator('[data-voice]').isVisible(),false);
    assert.equal(await item.locator('.family-course').textContent(),'Ещё 3 дня');
    assert.equal(await item.locator('.family-progress-count').count(),0);
    assert.ok(await page.locator('.family-form-icon svg').count()>=2);
    const dot=await item.locator('.family-intake-dot').first().boundingBox();
    assert.ok(dot.width>=22&&dot.height>=22);
    assert.match(await item.locator('.family-intake-progress').getAttribute('aria-label'),/1 из 3/);
    for(const edge of ['left','center','right']){
      await item.locator('.care-take').scrollIntoViewIfNeeded();
      let rect=await item.locator('.care-take').boundingBox();
      const disclosure=await item.locator('summary').boundingBox();
      assert.ok(rect.width>=64&&rect.height>=64);
      assert.ok(rect.x-disclosure.x-disclosure.width>=15.9);
      for(let tap=0;tap<2;tap++){
        await item.locator('.care-take').scrollIntoViewIfNeeded();
        rect=await item.locator('.care-take').boundingBox();
        await page.touchscreen.tap(edge==='left'?rect.x+2:edge==='right'?rect.x+rect.width-2:rect.x+rect.width/2,rect.y+rect.height/2);
        await settled();
        assert.equal(await item.locator('details').evaluate(node=>node.open),false);
      }
    }
    assert.match(await item.locator('.family-intake-progress').getAttribute('aria-label'),/1 из 3/);
    const disclosure=item.locator('summary');
    await disclosure.tap();
    await item.getByRole('button',{name:'Изменить назначение',exact:true}).tap();
    const input=page.locator('#rx-form [name=minHours]');
    await input.scrollIntoViewIfNeeded();
    const header=await page.locator('#family-info>header').boundingBox();
    const inputRect=await input.boundingBox();
    assert.ok(inputRect.y>=header.y+header.height-1);
    await input.tap();
    assert.equal(await input.evaluate(node=>node===document.activeElement),true);
    await page.getByRole('button',{name:'Закрыть',exact:true}).tap();
    await page.locator('#family-info').waitFor({state:'hidden'});
    checks.push({width,height,typography,contrast,checkboxEdges:true,modalHeaderClear:true,audioMuted:true});
  }

  await page.setViewportSize({width:390,height:844});
  await page.goto(origin+'/family');
  await page.locator('.family-intake-progress').first().waitFor();
  const normalSize=await item.locator('.care-med-name').evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  assert.equal(await item.locator('.care-med-name').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)),normalSize*2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok((await page.locator('.care-board').boundingBox()).height>=120);
  await item.locator('summary').tap();
  await item.getByRole('button',{name:'Изменить назначение',exact:true}).tap();
  await page.locator('#rx-form [name=dose]').fill('1');
  await page.getByRole('button',{name:'Закрыть',exact:true}).tap();
  checks.push({textScale:'200%',normalSize,enlargedSize:normalSize*2,modalUsable:true});
  await page.evaluate(()=>document.documentElement.style.fontSize='');
  await page.locator('.care-family [value=all]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const selected=page.locator('.care-family label:has(input:checked)');
  assert.equal(await selected.locator('input').inputValue(),other.id);
  const labelRect=await selected.boundingBox(),listRect=await page.locator('.care-family fieldset').boundingBox();
  assert.ok(labelRect.x>=listRect.x&&labelRect.x+labelRect.width<=listRect.x+listRect.width);
  await page.locator('.care-family label').first().tap();
  for(const theme of ['espresso','stone','sand']){
    await page.getByRole('button',{name:'Ещё',exact:true}).tap();
    await page.getByLabel('Тема расписания').selectOption(theme);
    await page.getByRole('button',{name:'Закрыть',exact:true}).tap();
    await page.reload();
    await page.locator('.family-intake-progress').first().waitFor();
    assert.equal(await page.locator('body').getAttribute('data-theme'),theme);
    for(const result of await measureContrast())assert.ok(result.ratio>=4.5,JSON.stringify({theme,...result}));
    assert.match(await item.locator('.family-intake-progress').getAttribute('aria-label'),/1 из 3/);
    await page.screenshot({path:`reports/family-theme-${theme}.png`});
  }
  for(const [width,height,name] of [[390,844,'phone'],[1024,900,'tablet']]){
    await page.setViewportSize({width,height});
    await page.goto(origin+'/family');
    await page.locator('.family-intake-progress').first().waitFor();
    await page.screenshot({path:`reports/family-readable-${name}.png`});
  }
  assert.deepEqual(errors,[]);
  await writeFile('reports/family-readability-canary.json',JSON.stringify({status:'PASS',syntheticOnly:true,physicalDeviceTested:false,keyboardNavigation:true,checks},null,2));
  console.log('PASS readable family, contrast, 200% text, separate touch targets, muted timers and modal scrolling');
}finally{
  await browser?.close();
  await app?.close();
  await rm(directory,{recursive:true,force:true});
}
