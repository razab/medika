import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';
import {localParts} from '../lib/domain.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const data=await mkdtemp(join(tmpdir(),'medika-dashboard-')),reports=join(dirname(fileURLToPath(import.meta.url)),'../../reports');
const port=14385,origin=`http://medika.localhost:${port}`,date=localParts(new Date(),'Europe/Chisinau').date;
const publicOrigin=process.env.MEDIKA_PUBLIC_PREVIEW_ORIGIN||origin;
let app,browser,token;
async function start(){app=await createApp({dataDir:data,port});await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));token=(await(await fetch(origin+'/api/session')).json()).token;}
async function api(path,body){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
const text=`1. ТестСпрей 50 мкг/доза — по 1 впрыскиванию в каждую ноздрю вечером, в течение 2 месяцев.
2. ТестСироп, раствор для приёма внутрь 0,5 мг/мл — по 4 мл 1 раз в день, в 17:00, в течение 2 месяцев.
3. ТестТаблетки 5 мг, жевательные таблетки — по 1 таблетке вечером перед сном, в течение 2 месяцев.
4. ТестВыходные 12 мг, таблетки — принимать по субботам и воскресеньям. Продолжительность курса — 6 недель.
При появлении окрашенных выделений из носа рекомендуется:
5. ТестУсловный, назальный спрей — по 2 впрыскивания в каждую ноздрю 3 раза в день, курсом не более 10 дней.
6. Через 10–15 минут после применения ТестУсловный использовать ТестСледующий, назальный спрей — по 1 впрыскиванию в каждую ноздрю 3 раза в день, в течение 5–7 дней.
7. Затем ТестЗавершение 50 мкг/доза — по 1 впрыскиванию в каждую ноздрю 3 раза в день, в течение 14 дней.`;
try{
  await start();
  for(const name of ['Папа','Мама'])await api('/people',{name});
  const children=[];
  for(const [name,ageYears]of [['Алиса',4],['Даня',6]]){
    const person=await api('/people',{name,ageYears,ageAsOf:date});children.push(person);
    const doc=await api('/documents',{personId:person.id,name:'Выписка · синтетический пример',text,sourceKind:'doctor'});assert.equal(doc.suggestions.length,7);
    await api('/documents',{personId:person.id,name:'Доска · синтетический пример',text:'12:00 тестовая запись мамы. План или факт не указан.',sourceKind:'household'});
  }
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // Published assets can be checked without reading or writing the family's real API.
  if(publicOrigin!==origin)await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),headers={...request.headers()};delete headers.host;delete headers.origin;delete headers['sec-fetch-site'];
    const response=await fetch(origin+url.pathname+url.search,{method:request.method(),headers,body:request.postData()||undefined});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await page.goto(publicOrigin);await page.locator('.family-board').waitFor({state:'attached'});
    assert.equal(await page.locator('.sidebar').count(),0);assert.equal(await page.locator('.home-menu').getAttribute('open'),null);
    assert.equal(await page.locator('.draft-plan > .draft-table > .draft-plan-row').count(),4);
    assert.equal(await page.locator('.conditional-plan .draft-plan-row').count(),3);
    const row=page.locator('.draft-plan-row').filter({has:page.getByRole('heading',{name:/^ТестСироп/})});
    assert.match(await row.innerText(),/17:00/);assert.match(await row.innerText(),/4 мл/);assert.match(await row.innerText(),/Алиса/);assert.match(await row.innerText(),/Даня/);
    assert.equal(await page.locator('.take-button').count(),0);
    for(const width of [1470,1024,768,390,360,320]){
      await page.setViewportSize({width,height:width===768?1024:768});
      const box=await row.boundingBox();assert.ok(box.y+box.height<768,'First medication must be visible without scrolling: '+width);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(width<=390){assert.ok((await page.locator('.home-bar').boundingBox()).height<=56);assert.ok(box.y<=95);assert.ok((await page.locator('.draft-plan > .draft-table > .draft-plan-row').last().boundingBox()).y<500);assert.ok(box.height<=100);}
      await page.screenshot({path:join(reports,`dashboard-${width}.png`),fullPage:width===390});
    }
    await row.locator('summary').click();await row.getByRole('button',{name:'Уточнить: Алиса',exact:true}).click();
    assert.equal(await page.locator('dialog input[name="times"]').inputValue(),'17:00');assert.equal(await page.locator('dialog input[name="dose"]').inputValue(),'4');assert.equal(await page.locator('dialog input[name="startDate"]').inputValue(),'');
    await page.locator('dialog input[name="startDate"]').fill(date);await page.locator('dialog input[name="confirmed"]').check();await page.getByRole('button',{name:'Добавить в расписание',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
    await page.locator('.family-timeline').waitFor();assert.match(await page.locator('.family-timeline').innerText(),/ТестСироп/);
    await row.locator('summary').click();assert.match(await page.locator('.family-timeline .person-inline').innerText(),/Алиса/);assert.doesNotMatch(await page.locator('.family-timeline').innerText(),/Даня/);assert.equal(await row.getByRole('button',{name:'Уточнить: Алиса',exact:true}).count(),0);assert.equal(await row.getByRole('button',{name:'Уточнить: Даня',exact:true}).count(),1);
    await page.locator('.family-timeline .take-button').click();await page.getByRole('button',{name:'Сохранить отметку',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
    await app.close();await start();await page.reload();await page.locator('.family-timeline .is-done').waitFor();
    await page.setViewportSize({width:390,height:768});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.ok((await page.locator('.family-timeline .schedule-item').boundingBox()).height<=100);await page.screenshot({path:join(reports,'dashboard-active-390.png')});
    const backup=await api('/backup');assert.equal(backup.events.length,1);assert.equal(backup.prescriptions.length,1);assert.equal(backup.people.length,4);assert.equal((await api('/restore',backup)).inserted,0);
    assert.deepEqual(errors,[]);
    await writeFile(join(reports,'dashboard-canary.json'),JSON.stringify({status:'PASS',verifiedAt:new Date().toISOString(),syntheticDataOnly:true,assetsOrigin:publicOrigin,apiOrigin:origin,checks:['Four profiles, zero active prescriptions, two shared doctor documents and household notes','Four regular rows and three conditional rows, shared instructions grouped without mixing personal prescriptions','Phone 320/360/390: header <=56px, first medication starts <=95px, row <=100px, fourth row starts <500px; tablet and desktop checked','No sidebar, closed menu, no fabricated active schedule','Person-specific confirmation, preserved dose/time and blank start date','Confirmed plan and intake on the same page; other child remains a draft','Restart and complete backup/restore preserve records','No horizontal overflow or browser errors']},null,2));
    console.log('PASS: data-first dashboard → personal confirmation → intake → restart → backup');
}finally{await browser?.close();await app?.close().catch(()=>{});await rm(data,{recursive:true,force:true});}
