import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';
import {nextDay,localParts} from '../lib/domain.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const port=14382,origin=`http://medika.localhost:${port}`,today=localParts(new Date(),'Europe/Chisinau').date;
const reports=join(dirname(fileURLToPath(import.meta.url)),'../../reports');await mkdir(reports,{recursive:true});
const data=await mkdtemp(join(tmpdir(),'medika-canary-')),restored=await mkdtemp(join(tmpdir(),'medika-restore-'));
let app,browser,token;const errors=[],checks=[];
async function start(directory=data){app=await createApp({dataDir:directory,port});await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));token=(await(await fetch(origin+'/api/session')).json()).token;}
async function request(path,body,method=body?'POST':'GET',expected=200){const response=await fetch(origin+'/api'+path,{method,headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;}
function check(name){checks.push({name,status:'PASS'});console.log('PASS',name);}
try{
  await start();browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1365,height:950},deviceScaleFactor:1});page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<html lang="ru"><body style="font:36px -apple-system;padding:70px;background:white;color:black"><h1 style="font-size:42px">Назначение · тест распознавания</h1><p>Ибупрофен 100 мг/5 мл по 2,5 мл 2 раза в день</p></body></html>');
  const image=join(data,'synthetic-prescription.png');await page.screenshot({path:image});
  const jpeg=await page.screenshot({type:'jpeg'});
  const webp=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1400;c.height=400;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.fillStyle='black';x.font='36px -apple-system';x.fillText('Ибупрофен 100 мг/5 мл по 2,5 мл 2 раза в день',50,150);return c.toDataURL('image/webp').split(',')[1];});
  await page.goto(origin);await page.getByRole('button',{name:'Добавить первого человека',exact:true}).click();
  await page.locator('dialog input[name="name"]').fill('Анна · тест');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
  let state=await request('/state');assert.equal(state.people.length,1);const first=state.people[0];
  const second=await request('/people',{name:'Борис · тест',allergies:'',color:'blue'},'POST',201);
  check('Два отдельных профиля, создание первого через интерфейс');
  await page.getByRole('button',{name:'▧ Загрузить выписку',exact:true}).click();await page.locator('dialog input[type=file]').setInputFiles(image);await page.getByRole('button',{name:'Распознать и сверить',exact:true}).click();
  await page.getByRole('heading',{name:'Сверка выписки',exact:true}).waitFor({timeout:60000});
  state=await request('/state');assert.equal(state.documents.length,1);const doc=state.documents[0];assert.match(doc.text,/Ибупрофен/iu);assert.ok(doc.suggestions.length);assert.equal(doc.suggestions[0].dose,'2.5');assert.equal(doc.suggestions[0].unit,'мл');
  await writeFile(join(reports,'canary-ocr.json'),JSON.stringify({text:doc.text,suggestions:doc.suggestions,lines:doc.lines},null,2));
  check('Синтетическое изображение → Apple Vision RU → сохранённый оригинал и черновик');
  for(const [name,image]of [['Тест JPEG',jpeg.toString('base64')],['Тест WebP',webp]]){const extra=await request('/documents',{personId:first.id,name,image},'POST',201);assert.match(extra.text,/Ибупрофен/iu);assert.equal(extra.suggestions[0].dose,'2.5');}
  check('Три заявленных формата проходят локальный OCR: PNG, JPEG и WebP');
  await page.getByRole('button',{name:'Заполнить назначение из строки →',exact:true}).first().click();
  await page.locator('dialog input[name="ingredients"]').fill('ибупрофен');await page.locator('dialog input[name="times"]').fill('08:00, 20:00');await page.locator('dialog input[name="startDate"]').fill(today);await page.locator('dialog input[name="endDate"]').fill(nextDay(today,2));await page.locator('dialog input[name="confirmed"]').check();await page.getByRole('button',{name:'Добавить в расписание',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
  state=await request('/state');assert.equal(state.prescriptions.length,1);const rx=state.prescriptions[0];assert.equal(rx.personId,first.id);assert.equal(rx.documentId,doc.id);assert.equal(rx.dose,'2.5');assert.equal(rx.strength,'100 мг/5 мл');
  await page.locator('nav button[data-view="today"]').click();await page.getByRole('button',{name:'Отметить',exact:true}).first().click();await page.getByRole('button',{name:'Сохранить отметку',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Принято',{exact:true}).first().waitFor();await page.screenshot({path:join(reports,'canary-desktop.png'),fullPage:true});
  check('Подтверждение черновика → видимое расписание → фактическая отметка');
  const schedule=await request('/schedule?date='+today+'&personId='+first.id);assert.equal(schedule.items.length,2);assert.equal(schedule.items[0].event.status,'taken');
  await request('/events',{rxId:rx.id,key:schedule.items[0].key,date:today,status:'taken'},'POST',409);
  assert.equal((await request('/schedule?date='+nextDay(today,-1))).items.length,0);assert.equal((await request('/schedule?date='+nextDay(today,2))).items.length,2);assert.equal((await request('/schedule?date='+nextDay(today,3))).items.length,0);
  const base={name:'Тест интервала',ingredients:'варфарин',dose:'1',unit:'табл.',startDate:today,endDate:nextDay(today,2),type:'interval',intervalHours:'8',anchorTime:'22:00',timeZone:'Europe/Chisinau',confirmed:true,personId:second.id};
  await request('/prescriptions',base,'POST',201);const once=await request('/prescriptions',{...base,name:'Тест разовый',type:'once',times:'10:00'},'POST',201);const prn=await request('/prescriptions',{...base,name:'Тест по необходимости',type:'prn',minHours:'8',maxPer24h:'2'},'POST',201);
  const tomorrow=await request('/schedule?date='+nextDay(today)+'&personId='+second.id);assert.equal(tomorrow.items.length,3);assert.ok(tomorrow.items.every(i=>i.rxId!==once.id));assert.equal(tomorrow.prn.length,1);
  const prnEvent=await request('/events',{rxId:prn.id,date:today,status:'taken',dose:'1'},'POST',201);assert.equal(prnEvent.date,today);
  const isolated=await request('/check',{personId:first.id});assert.ok(!isolated.findings.some(f=>f.id.startsWith('warfarin')));
  const candidate=await request('/check',{personId:first.id,candidate:{name:'Тест сочетания',ingredients:'варфарин'}});assert.ok(candidate.findings.some(f=>f.id.startsWith('warfarin')));assert.equal(candidate.status,'incomplete');
  check('Границы курса, интервальный/разовый/PRN режимы, изоляция людей и повтор отметки');
  const duplicate=await request('/documents',{personId:first.id,name:'Повтор',image:(await readFile(image)).toString('base64')});assert.equal(duplicate.duplicate,true);assert.equal((await request('/state')).documents.length,3);
  await request('/documents',{personId:first.id,image:Buffer.from('<svg/>').toString('base64')},'POST',415);
  await request('/prescriptions',{...base,confirmed:false},'POST',400);
  const forbidden=await fetch(origin+'/api/people',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://example.com','X-Medika-Token':token},body:'{"name":"Чужой сайт"}'});assert.equal(forbidden.status,403);
  check('Повторная загрузка без дублей, запрет SVG, неподтверждённых назначений и чужого Origin');
  const backup=await request('/backup');assert.ok(backup.images[doc.id]);await writeFile(join(reports,'canary-backup-metadata.json'),JSON.stringify({people:backup.people.length,documents:backup.documents.length,prescriptions:backup.prescriptions.length,events:backup.events.length,audit:backup.audit.length},null,2));
  await app.close();await start();await page.reload();await page.getByText('Принято',{exact:true}).first().waitFor();assert.equal((await request('/state')).events.length,2);
  check('Перезапуск сервера → восстановление SQLite, источников и пользовательского экрана');
  await app.close();await start(restored);const restore=await request('/restore',backup);assert.equal(restore.inserted,2+3+4+2);assert.equal((await request('/restore',backup)).inserted,0);const restoredState=await request('/state');assert.equal(restoredState.events.length,2);
  const bad=structuredClone(backup);bad.people[0].name='Конфликт';await request('/restore',bad,'POST',409);assert.equal((await request('/state')).people[0].name,first.name);
  await page.reload();await page.getByText('Принято',{exact:true}).first().waitFor();await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(reports,'canary-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  check('Полная копия с изображением → пустая база → повтор без дублей и атомарный отказ конфликта');
  await page.locator('nav [data-view="reference"]').click();await page.locator('#check-form select').selectOption(first.id);await page.locator('#check-form input[name="name"]').fill('Предполагаемое средство');await page.locator('#check-form input[name="ingredients"]').fill('варфарин');await page.getByRole('button',{name:'Проверить с назначениями',exact:true}).click();await page.locator('#check-result .finding').first().waitFor();assert.match(await page.locator('#check-result').innerText(),/Варфарин и ибупрофен/);assert.ok(await page.locator('.prescribed-reference').isVisible());
  await page.screenshot({path:join(reports,'reference-mobile.png'),fullPage:true});
  for(const view of ['prescriptions','documents','journal','people','settings']){await page.locator(`nav [data-view="${view}"]`).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Горизонтальный скролл: '+view);}
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать резервную копию',exact:true}).click();const downloaded=await downloadPromise;assert.match(downloaded.suggestedFilename(),/^medika-backup-/);
  await page.locator('nav [data-view="people"]').click();await page.locator('[data-act="edit-person"]').first().click();await page.locator('dialog textarea[name="notes"]').fill('Примечание тестового профиля');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});await page.getByText('Примечание тестового профиля',{exact:true}).waitFor();
  await page.locator('nav [data-view="prescriptions"]').click();await page.locator('[data-act="add-rx"]').first().click();await page.locator('dialog select[name="personId"]').selectOption(second.id);await page.locator('dialog input[name="name"]').fill('Выбор второго человека');await page.locator('dialog input[name="dose"]').fill('1');await page.locator('dialog input[name="times"]').fill('12:00');await page.locator('dialog input[name="confirmed"]').check();await page.getByRole('button',{name:'Добавить в расписание',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});assert.equal((await request('/state')).prescriptions.find(r=>r.name==='Выбор второго человека').personId,second.id);
  check('Все разделы на 390 px, справочная проверка, персональные дозы, скачивание копии и выбор второго человека');
  await page.locator('[data-act="add-rx"]').first().click();await page.locator('dialog input[name="name"]').fill('Тест назального спрея');await page.locator('dialog input[name="dose"]').fill('1');await page.locator('dialog select[name="unit"]').selectOption('впрыскивание');await page.locator('dialog select[name="doseScope"]').selectOption('each-nostril');await page.locator('dialog input[name="times"]').fill('08:00, 20:00');await page.locator('dialog input[name="startDate"]').fill(today);
  for(const d of [1,2,3,4,5])await page.locator(`dialog input[name="weekday"][value="${d}"]`).uncheck();await page.locator('dialog input[name="weekday"][value="0"]').check();await page.locator('dialog input[name="weekday"][value="6"]').check();await page.locator('dialog input[name="courseCount"]').fill('2');await page.locator('dialog select[name="courseUnit"]').selectOption('months');await page.locator('dialog [data-course-end]').click();await page.locator('dialog [data-course-result]').filter({hasText:'Последний день включительно'}).waitFor();await page.locator('dialog input[name="confirmed"]').check();await page.getByRole('button',{name:'Добавить в расписание',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});assert.match(await page.locator('#content').innerText(),/в каждую ноздрю/);const scoped=(await request('/state')).prescriptions.find(r=>r.name==='Тест назального спрея');assert.deepEqual(scoped.weekdays,[0,6]);assert.equal(scoped.doseScope,'each-nostril');
  await page.locator('nav [data-view="today"]').click();await page.locator('.family-board').waitFor();assert.equal(await page.locator('.family-card').count(),2);await page.screenshot({path:join(reports,'weekend-spray-mobile.png'),fullPage:true});
  const savedWithScope=await request('/backup');assert.equal((await request('/restore',savedWithScope)).inserted,0);
  check('Реальная форма: выходные, спрей на каждую ноздрю, календарные месяцы и сохранение в копии');
  await request('/people',{name:'Папа',color:'blue'},'POST',201);await request('/people',{name:'Мама',color:'peach'},'POST',201);
  // Use the same API verb as the profile form, preserving IDs and source links.
  for(const [id,displayName]of [[first.id,'Лиса · тест'],[second.id,'Даня · тест']]){const p=(await request('/state')).people.find(p=>p.id===id);await request('/people/'+id,{...p,displayName},'PUT',200);}
  const draft=await request('/documents',{personId:first.id,name:'Врач · синтетический черновик',sourceKind:'doctor',text:'ТестЧерновик 10 мг по 1 табл.\nв день, в 17:00, в течение 2 месяцев.'},'POST',201);
  await page.reload();await page.locator('.family-board').waitFor();assert.equal(await page.locator('.family-card').count(),4);assert.equal(await page.locator('.person-tabs').count(),0);
  for(const text of ['Папа','Мама','Лиса · тест','Даня · тест'])assert.ok((await page.locator('.family-board').innerText()).includes(text));
  await page.locator('.family-course [data-act="edit-rx"]').first().click();await page.locator('dialog textarea[name="purpose"]').fill('Цель со слов врача <тест>');await page.locator('dialog input[name="confirmed"]').check();await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});
  assert.ok((await page.locator('.family-timeline').innerText()).includes('Цель со слов врача <тест>'));assert.ok((await page.locator('.family-board').innerText()).includes('Цель со слов врача <тест>'));assert.ok(page.url().endsWith('/#today'));
  assert.match(await page.locator('.family-timeline .is-done .intake-purpose').first().innerText(),/Цель не указана/);
  const draftButton=page.locator(`[data-act="draft-rx"][data-id="${draft.id}"]`);const draftCard=draftButton.locator('xpath=../..');assert.match(await draftCard.innerText(),/17:00/);assert.match(await draftCard.innerText(),/Дата начала не подтверждена/);await draftButton.click();assert.equal(await page.locator('dialog input[name="startDate"]').inputValue(),'');assert.equal(await page.locator('dialog input[name="times"]').inputValue(),'17:00');await page.locator('dialog [data-cancel]').click();assert.ok(page.url().endsWith('/#today'));
  const before=(await request('/state')).events.length;await page.locator('.family-timeline .take-button').first().click();await page.getByRole('button',{name:'Сохранить отметку',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});assert.equal((await request('/state')).events.length,before+1);assert.ok(page.url().endsWith('/#today'));
  await page.locator('nav [data-view="prescriptions"]').click();await page.locator(`.person-tabs [data-act="filter-person"][data-id="${first.id}"]`).click();await page.locator('nav [data-view="today"]').click();await page.locator('.family-board').waitFor();assert.equal(await page.locator('.family-card').count(),4);
  const dad=(await request('/state')).people.find(p=>p.name==='Папа');const future=await request('/prescriptions',{...base,personId:dad.id,name:'Тест будущего курса',purpose:'Будущая цель · тест',type:'daily',times:'09:00',startDate:nextDay(today),endDate:nextDay(today,5)},'POST',201);await page.reload();await page.locator('.family-board').waitFor();const futureCard=page.locator(`[data-rx-card="${future.id}"]`);assert.equal(await futureCard.isVisible(),false);await page.locator(`[data-person-card="${dad.id}"] .family-upcoming summary`).click();assert.equal(await futureCard.isVisible(),true);assert.match(await futureCard.innerText(),/Начнётся/);await page.locator(`[data-person-card="${dad.id}"] .family-upcoming summary`).click();
  for(const width of [1470,1024,390]){await page.setViewportSize({width,height:918});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Горизонтальный скролл семейной доски: '+width);await page.screenshot({path:join(reports,`family-board-${width}.png`),fullPage:width===390});}
  const familyBackup=await request('/backup');assert.equal((await request('/restore',familyBackup)).inserted,0);
  check('Четыре человека, текущие курсы и цель на главной, черновик/отметка без перехода, возврат из фильтра и 1470/1024/390 px');
  assert.deepEqual(errors,[]);check('Браузер без ошибок JavaScript, локальный домен и мобильный экран');
  await writeFile(join(reports,'canary-result.json'),JSON.stringify({status:'PASS',completedAt:new Date().toISOString(),checks,errors},null,2));
}catch(error){console.error(error);await writeFile(join(reports,'canary-result.json'),JSON.stringify({status:'FAIL',checks,error:error.stack,errors},null,2));process.exitCode=1;}
finally{await browser?.close();await app?.close().catch(()=>{});await rm(data,{recursive:true,force:true});await rm(restored,{recursive:true,force:true});}
