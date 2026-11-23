import {familyThemes, familyIcon} from '/family-appearance.js';
import {medicineReferenceHTML,medicineGroupLabel} from '/medicine-reference.js';
import {shortDose,measurementStamp} from '/family-preview-model.js';
import {careDrug,careFamily,escapeHTML as e} from '/family-card.js';
import {anchors,relations,profileSlots,dailyRoutine} from '/routine.js';
import {medicineForms,allowedMedicineUnits} from '/medicine-forms.js';
import {prescriptionSummary} from '/prescription-summary.js';
import {intakeTimer,prescribedInterval,dailyIntakeProgress,manualIntakeTimers,suggestedManualInterval} from '/intake-timer.js';
import {allRows,activeEvents,rowEvent,dependencyStatus,dependencyTimer,courseWarnings,localInstant} from '/design-study/a1-events.js';
import {photosForMedicine} from '/medicine-images.js';
import '/voice-draft-cleanup.js';
const root=document.querySelector('#family'),dialog=document.querySelector('#family-info'),notice=document.querySelector('#family-status');
let snapshot,selected=localStorage.getItem('medika-family-person')||'all',actions=[],openKey='',historyDrug=false,saving=false,loading=false,token='';
function setTheme(id) {
  if (!familyThemes.some(theme => theme.id === id)) id = 'sand';
  document.body.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.body).getPropertyValue('--bg').trim();
  return id;
}
setTheme(localStorage.getItem('medika-family-theme'));

const coursePlural = new Intl.PluralRules('ru');
function remainingCourse(endDate, day) {
  if (!endDate) return '';
  const days = (Date.parse(endDate) - Date.parse(day)) / 86400000 + 1;
  if (!Number.isInteger(days) || days < 1) return '';
  if (days === 1) return 'Последний день';
  return 'Ещё ' + days + ' ' + ({one:'день', few:'дня', many:'дней', other:'дня'})[coursePlural.select(days)];
}

const outsideOpen=new Set(),newId=()=> 'family-'+Array.from(crypto.getRandomValues(new Uint32Array(2)),n=>n.toString(16)).join('');
const baseRows=()=>allRows(snapshot),rxFor=id=>snapshot.prescriptions.find(r=>r.id===id)||{},phaseOf=p=>p.phaseKey;
const planDate=row=>row.scheduledDate||snapshot.model.date;
const effectiveRow=row=>({...row,warnings:courseWarnings(rxFor(row.prescriptionId),planDate(row))});
function visibleRow(row,person){
  const rx=rxFor(row.prescriptionId),date=planDate(row);
  return rx.confirmed&&(!rx.phase||rx.phase===phaseOf(person))&&rx.startDate<=date&&(!rx.endDate||rx.endDate>=date);
}
const calendarDate=(instant=snapshot.contextAt)=>new Date(instant).toLocaleDateString('sv-SE',{timeZone:snapshot.timeZone});
function message(text,undoId=''){notice.innerHTML=`<span>${e(text)}</span>${undoId?`<button type="button" data-undo="${e(undoId)}">Отменить</button>`:''}`;clearTimeout(message.timer);message.timer=setTimeout(()=>notice.textContent='',12000);}
let refreshWarning='';
const reloadMessage='Обновите журнал перед новой записью.';
const journalWriteControls='[data-take], [data-record], [data-add-event], [data-medicine-actions], [data-add-intake], [data-add-medicine], [data-edit], [data-edit-event], [data-cancel], button[type="submit"]';
async function api(path,body=null,method=body?'POST':'GET',retrySession=true){
  if(!token){
    const session=await fetch('/api/session');
    if(session.status===401)location.replace('/login');
    if(!session.ok)throw Error('Не удалось открыть сессию');
    token=(await session.json()).token;
  }
  const requestToken=token;
  let response,value;
  try{
    response=await fetch('/api'+path,{method,headers:{'X-Medika-Token':requestToken,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    value=await response.json();
  }catch{
    const error=Error('Ответ журнала не получен');
    error.uncertain=method!=='GET';
    throw error;
  }
  if(!response.ok){
    if(response.status===401)location.replace('/login');
    if(response.status===403&&token===requestToken)token='';
    if(method==='GET'&&retrySession&&response.status===403&&value.error==='Сессия обновлена. Перезагрузите страницу.'){
      return api(path,null,'GET',false);
    }
    const error=Error(value.error||'Не удалось сохранить');
    error.status=response.status;
    error.uncertain=method!=='GET'&&response.status>=500;
    throw error;
  }
  return value;
}
function setBusy(value){
  root.setAttribute('aria-busy',String(value));
  for(const control of [...root.querySelectorAll('input,button,select'),...dialog.querySelectorAll('input,button,select,textarea')]){
    const locked=value||(refreshWarning&&control.matches(journalWriteControls));
    if(locked){
      if(!('wasDisabled' in control.dataset))control.dataset.wasDisabled=String(control.disabled);
      control.disabled=true;
    }else if('wasDisabled' in control.dataset){
      control.disabled=control.dataset.wasDisabled==='true';
      delete control.dataset.wasDisabled;
    }
  }
  updateFooterOffset();
}
function renderRefreshWarning(){
  const panel=root.querySelector('.family-refresh-warning');
  panel.querySelector('p').textContent=refreshWarning;
  panel.hidden=!refreshWarning;
  if(refreshWarning){
    for(const timer of root.querySelectorAll('.family-timers,[data-intake-row]'))timer.hidden=true;
  }
}
async function refresh(){
  const next=await api('/family');
  const previous={snapshot,selected,refreshWarning};
  try{
    snapshot=next;
    if(!snapshot.model.cards.some(p=>p.id===selected))selected='all';
    refreshWarning='';
    render();
  }catch(error){
    ({snapshot,selected,refreshWarning}=previous);
    throw error;
  }
}
async function load(){
  if(loading||saving||dialog.open)return;
  loading=true;
  const retry=root.querySelector('[data-retry]');
  if(retry)retry.disabled=true;
  try{
    await refresh();
  }catch(error){
    if(!refreshWarning)message(error.message);
    if(!snapshot)root.innerHTML='<main class="family-loading"><p>Не удалось открыть журнал</p><button data-retry>Обновить</button></main>';
  }finally{
    loading=false;
    if(retry)retry.disabled=false;
  }
}
async function mutate(path,body,method='POST',{close=true,success='Сохранено',undo=false}={}){
  if(saving)return;
  if(refreshWarning){
    const field=dialog.open&&dialog.querySelector('.sandbox-form-error');
    if(field)field.textContent=reloadMessage;
    else{if(dialog.open)dialog.close();message(reloadMessage);}
    return null;
  }
  saving=true;
  setBusy(true);
  let result,error;
  try{result=await api(path,body,method);}catch(e){error=e;}
  try{
    if(!error||error.uncertain||[403,409].includes(error.status))await refresh();
  }catch{
    const writeStatus=!error?success+'.':error.uncertain?'Ответ на запись не получен.':error.message;
    refreshWarning=writeStatus+' Показана предыдущая версия журнала. '+reloadMessage;
    renderRefreshWarning();
  }finally{
    saving=false;
    setBusy(false);
  }
  if(refreshWarning){
    if(dialog.open)dialog.close();
    return result??null;
  }
  if(!error){if(close&&dialog.open)dialog.close();message(success,undo?result.id:'');return result;}
  if(error.uncertain){if(dialog.open)dialog.close();message('Ответ на запись не получен. Состояние обновлено из журнала; проверьте запись перед повтором.');}
  else if([403,409].includes(error.status)){if(dialog.open)dialog.close();message(error.message+' Откройте действие заново.');}
  else {const target=dialog.open&&dialog.querySelector('.sandbox-form-error');if(target)target.textContent=error.message;else message(error.message);}
  return null;
}
async function record(row,time=new Date().toISOString(),unknown=false,amount=row.amount,clientKey=newId(),knownDate=calendarDate(new Date())){
  const rx=rxFor(row.prescriptionId);if(!rx.id)return;if(Date.now()>=Date.parse(snapshot.dayEndsAt)){if(dialog.open)dialog.close();await load();message('День изменился. Выберите приём заново.');return;}
  return mutate('/events',{rxId:rx.id,rxVersion:row.rxVersion??rx.version,key:row.key,date:planDate(row),status:'taken',dose:amount,...(rx.input.type==='prn'?{clientKey}:{}),...(unknown?{timeUnknown:true,knownDate,occurredAt:null}:{occurredAt:time})},'POST',{success:'Приём записан',undo:true});
}
async function cancel(id){if(!snapshot.model.history.some(r=>r.id===id)&&!dialog.open)await load();const event=snapshot.model.history.find(r=>r.id===id);if(!event||event.status==='void')return;return mutate('/'+event.source+'/'+event.id+'/void',{version:event.version,reason:'Отменено на семейной доске'},'POST',{success:'Запись отменена'});}
const fields=list=>`<dl class="prescription-fields">${list.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
function showDialog(title,body){dialog.innerHTML=`<header><h2 id="family-info-title">${e(title)}</h2><button type="button" data-close>Закрыть</button></header><div class="family-dialog-content">${body}</div>`;dialog.showModal();if(refreshWarning)setBusy(saving);}
function medicineThumb(name){const photos=photosForMedicine(name,snapshot.medicinePhotos||[]).photos,p=photos.find(p=>p.kind==='product')||photos[0];if(!p)return '';return `<span class="family-thumb" aria-hidden="true">${p.crop?`<svg viewBox="${p.crop.slice(0,4).join(' ')}"><image href="${e(p.src)}" width="${p.crop[4]}" height="${p.crop[5]}"/></svg>`:`<img src="${e(p.src)}" alt="">`}</span>`;}
function medicinePhotos(name){const record=photosForMedicine(name,snapshot.medicinePhotos||[]);return record.photos.length?`<section class="family-photos">${record.photos.map(p=>p.crop?`<figure><svg viewBox="${p.crop.slice(0,4).join(' ')}" role="img" aria-label="${e(name)}"><image href="${e(p.src)}" width="${p.crop[4]}" height="${p.crop[5]}"/></svg><figcaption>${p.kind==='product'?'Препарат':'Упаковка'}${p.note?' · '+e(p.note):''}</figcaption>${p.source?`<a href="${e(p.source)}" target="_blank" rel="noreferrer">Источник фото</a>`:''}</figure>`:`<figure><img src="${e(p.src)}" alt="${e(name)}"><figcaption>${p.kind==='product'?'Препарат':'Упаковка'}${p.note?' · '+e(p.note):''}</figcaption>${p.source?`<a href="${e(p.source)}" target="_blank" rel="noreferrer">Источник фото</a>`:''}</figure>`).join('')}</section>`:'';}
function referenceForRow(row){const rx=rxFor(row.prescriptionId),id=rx.input?.medicineId,form=rx.form||rx.suggestedForm,candidates=snapshot.medicines.filter(m=>(id?m.id===id:m.name.trim().toLocaleLowerCase()===row.name.trim().toLocaleLowerCase())&&m.medicineForm===form);if(candidates.length!==1)return;const m=candidates[0],strength=s=>String(s||'').toLowerCase().replace(/мг/g,'mg').replace(/мл/g,'ml').replace(/,/g,'.').replace(/\s+/g,'');if(m.name.trim().toLocaleLowerCase()!==row.name.trim().toLocaleLowerCase()||strength(rx.strength)!==strength(m.strength))return;return m.reference;}
function medicineInfo(key){const row=baseRows().find(r=>r.key===key);if(!row)return;showDialog(row.name,`${medicinePhotos(row.name)}${row.aftercare?`<section><h3>После применения · ваше напоминание</h3><p>${e(row.aftercare)}</p></section>`:''}${medicineReferenceHTML(referenceForRow(row))}${row.info.fields.length?`<section><h3>Данные препарата</h3>${fields(row.info.fields)}</section>`:''}${row.info.notes.length?`<section><h3>Условия назначения</h3>${fields(row.info.notes)}</section>`:''}${row.info.source?`<details class="medicine-source"><summary>Исходная запись врача</summary><p>${e(row.info.source)}</p></details>`:''}`);}
function renderRow(source,later=false){const row=effectiveRow(source),event=rowEvent(snapshot,actions,row),status=event?`Принято · ${event.occurredAt?formatTime(event.occurredAt):'время неизвестно'}`:row.status||'',dependencyState=dependencyStatus(snapshot,actions,row),dependency=dependencyState==='Нет записи первого приёма'&&row.dependency?.prescriptionId?'':dependencyState,reference=referenceForRow({...row,name:event?.name||row.name});
  let html=careDrug(event?.name||row.name,event?.input?shortDose({dose:event.input.actualDose||event.input.amount||event.input.dose,unit:event.input.unit}):row.dose,'',{later,showTake:!later||rxFor(row.prescriptionId).input?.type!=='prn',readOnly:row.anchor==='unassigned'||row.canTake===false,actionKey:row.anchor==='unassigned'?'':row.key,fields:row.fields,moreId:row.info.fields.length||row.info.notes.length||row.info.source||reference?row.key:'',after:row.after,taken:!!event,status});
  const rx = rxFor(row.prescriptionId);
  const form = rx.form || rx.suggestedForm;
  const glyph = familyIcon(['liquid','inhalation','injection'].includes(form) ? 'solution' : form);
  const visual = glyph ? `<span class="family-form-icon" aria-hidden="true">${glyph}</span>` : medicineThumb(row.name);
  const remaining = remainingCourse(rx.endDate, planDate(row));
  html=html.replace(/<span class="care-med-name" data-drug-name>(.*?)<\/span>/,(_,name)=>`<span class="care-med-name" data-drug-name>${visual}<span class="family-drug-label">${name}${remaining?`<small class="family-course">${e(remaining)}</small>`: ''}</span>${row.warnings.length?`<span class="family-review-marker" role="img" aria-label="Расхождение назначения" title="${e(row.warnings.join(' · '))}">!</span>`:''}</span>`);
  html=html.replace('</summary>',`<small class="family-medicine-group">${e(medicineGroupLabel(reference))}</small></summary>`);
  html=html.replace('</dl>','</dl>'+`<div class="sandbox-row-actions"><button type="button" data-record="${e(row.key)}">${event||row.eventId?'Изменить факт':'Записать приём'}</button><button type="button" data-edit="${e(row.prescriptionId)}">Изменить назначение</button></div>`);
  if(row.warnings.length)html=html.replace('</summary>',`</summary><p class="sandbox-warning">${e(row.warnings.join(' · '))}</p>`);
  const frequency=prescriptionSummary(rxFor(row.prescriptionId).input||{}).frequency;
  const progress=dailyIntakeProgress(snapshot,row,actions);
  const dots=progress?`<span class="family-intake-progress" role="img" aria-label="Принято ${progress.taken} из ${progress.total} ${progress.period}">${Array.from({length:progress.total},(_,i)=>`<span class="family-intake-dot${i<progress.taken?' is-taken':''}" aria-hidden="true"></span>`).join('')}</span><span class="sr-only">${e(frequency)}</span>`:'';
  html=html.replace(/(<strong class="care-dose">.*?<\/strong>)/,(_,dose)=>`<span class="family-dose-block">${dose}${dots}</span>`);
  const frequencyNote=progress?(progress.taken>progress.total?'Превышено указанное количество':''):frequency;
  return `<div class="sandbox-dose${openKey===row.key?' is-selected':''}" data-demo-row="${e(row.key)}">${html}${frequencyNote?`<p class="family-frequency">${e(frequencyNote)}</p>`:''}<p class="family-intake-timer" data-intake-row="${e(row.key)}" hidden></p>${row.dependency?`<p class="dependency-state" data-dependency-row="${e(row.key)}">${e(dependencyTimer(snapshot,actions,row)?.text||dependency)}</p>`:''}${event&&row.aftercare?`<p class="family-aftercare">После ингаляции: ${e(row.aftercare)}</p>`:''}</div>`;
}
function medicinePlus(personId='',label='',anchor='',time=''){
  const description=label?'Действия с лекарством: '+label:'Действия с лекарством';
  return `<button type="button" class="family-medicine-plus" data-medicine-actions="${e(personId)}" data-anchor="${e(anchor)}" data-time="${e(time)}" aria-haspopup="dialog" aria-label="${e(description)}">+</button>`;
}
function emptyMedication(text,person){
  return `<div class="family-empty-medication"><p class="family-empty">${e(text)}</p>${medicinePlus(person?.id,person?.name)}</div>`;
}
function group(g,p){
  const rows=g.rows.filter(r=>visibleRow(r,p));
  if(!rows.length)return '';
  const anchor=rows[0].anchor,clock=anchor==='clock';
  const plus=medicinePlus(p.id,`${p.name}, ${g.label}`,clock?'':p.daySlots?'slot:'+anchor:anchor,clock?g.time||'':'');
  return `<section class="care-current family-day-slot"><div class="family-slot-heading"><h3 class="sandbox-current-label">${e(g.label)}</h3>${plus}</div>${rows.map(r=>renderRow({...r,personId:p.id})).join('')}</section>`;
}
function peopleView(){return snapshot.model.cards;}
function card(p){
  const own=snapshot.prescriptions.filter(r=>r.personId===p.id),phase=phaseOf(p);
  const groups=[...p.earlier,...(p.current?[p.current]:[]),...p.later];
  const visibleIds=new Set([...groups.flatMap(g=>g.rows),...p.prn].filter(r=>visibleRow(r,p)).map(r=>r.prescriptionId)),hasRows=visibleIds.size>0;
  const outside=own.filter(r=>!visibleIds.has(r.id)&&(!r.confirmed||r.phase&&r.phase!==phase||r.startDate>snapshot.model.date||r.endDate&&r.endDate<snapshot.model.date));
  const slotOrder=p.daySlots?profileSlots(p).map(s=>s.id):Object.keys(anchors),rank=g=>{const anchor=g.rows[0]?.anchor,index=slotOrder.indexOf(anchor);return index>=0?index:slotOrder.length+(anchor==='clock'?1:2);};
  // Meals keep their daily order even when their clock times are unknown. Exact times remain explicit.
  groups.sort((a,b)=>rank(a)-rank(b)||planDate(a.rows[0]).localeCompare(planDate(b.rows[0]))||(a.time||'').localeCompare(b.time||''));
  const planned=groups.map(g=>group(g,p)).join(''),prn=p.prn.filter(r=>visibleRow(r,p));
  const fallback=hasRows?'':emptyMedication(own.length&&phase==='prevention'?'Поддерживающая схема ещё не добавлена':'Нет действующих плановых назначений',p);
  const plan=planned+fallback+(outside.length?`<details class="care-earlier family-outside-plans" data-outside-plans="${e(p.id)}"${outsideOpen.has(p.id)?' open':''}><summary>Другие назначения</summary><section class="family-outside">${outside.map(r=>`<button class="sandbox-outside" type="button" data-edit="${e(r.id)}">${e(r.name)}<small>${e(!r.confirmed?'Не подтверждено':r.phase&&r.phase!==phase?(r.phase==='acute'?'Для острой фазы':'Для поддерживающей фазы'):courseWarnings(r,snapshot.model.date).join(' · ')||'Курс завершён')}</small></button>`).join('')}</section></details>`:'');
  const prnHeading='<h3>По необходимости</h3>';
  const prnPlan=prn.length?`<section class="care-later">${planned?prnHeading:`<div class="family-empty-medication">${prnHeading}${medicinePlus(p.id,p.name)}</div>`}${prn.map(r=>renderRow({...r,personId:p.id},true)).join('')}</section>`:'';
  const temperature=activeEvents(snapshot,actions).filter(r=>r.personId===p.id&&r.kind==='temperature').sort((a,b)=>(b.date||'').localeCompare(a.date||'')||Date.parse(b.occurredAt||b.input?.createdAt||0)-Date.parse(a.occurredAt||a.input?.createdAt||0))[0];
  return `<section class="care-person color-${p.color}" data-person="${e(p.id)}"><header class="care-person-head"><div class="family-person-identity"><h2>${e(p.name)}</h2>${phase||own.length?`<span class="family-phase-status" data-phase-status="${e(phase)}">${e(phase==='acute'?'Острая фаза':phase==='prevention'?'Поддерживающая':'Фаза не задана')}</span>`:''}</div>${temperature?`<span class="care-phase">${e(temperature.name)}<small>${e(measurementStamp(temperature,calendarDate(),snapshot.timeZone))}</small></span>`:''}</header>${plan}${prnPlan}${!hasRows?`<button type="button" class="sandbox-empty-event" data-add-event="${e(p.id)}">Записать событие</button>`:''}</section>`;
}
const formatTime=instant=>new Date(instant).toLocaleTimeString('ru-RU',{timeZone:snapshot.timeZone,hour:'2-digit',minute:'2-digit'});
const formatDate=instant=>new Date(instant).toLocaleDateString('ru-RU',{timeZone:snapshot.timeZone,day:'numeric',month:'long'});
function eventHTML(r,names,local=false,grouped=false){const cancelled=r.status==='void';return `<button type="button" class="care-event family-event-open${cancelled?' is-cancelled':''}" data-kind="${e(r.kind)}" data-open-event="${e(r.id)}" aria-label="Открыть событие: ${e(names.get(r.personId)||'')} · ${e(r.name)}"><time>${r.occurredAt?e(formatTime(r.occurredAt)):'—'}${!grouped&&r.date!==calendarDate()?`<small>${e(r.date.slice(5).split('-').reverse().join('.'))}</small>`:''}</time><span>${e(names.get(r.personId)||'')}</span><strong>${e(r.name)}<small>${e(r.detail||'')}${cancelled?' · отменено':''}${!r.occurredAt?' · время неизвестно':''}</small></strong></button>`;}
function historyDays(history,names){const today=calendarDate(),groups=new Map();for(const r of history){if(!groups.has(r.date))groups.set(r.date,[]);groups.get(r.date).push(r);}return [...groups].sort(([a],[b])=>b.localeCompare(a)).map(([date,rows])=>`<section class="family-history-day">${date!==today?`<h3>${e(new Date(date+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',...(date.slice(0,4)!==today.slice(0,4)?{year:'numeric'}:{})}))}</h3>`:''}${rows.map(r=>eventHTML(r,names,false,true)).join('')}</section>`).join('');}
function historyHTML(people=snapshot.model.cards){
  const names=new Map(people.map(p=>[p.id,p.name])),chosen=baseRows().find(r=>r.key===openKey),filter=r=>(selected==='all'||r.personId===selected)&&(!historyDrug||!chosen||r.personId===chosen.personId&&(r.prescriptionId===chosen.prescriptionId||r.name===chosen.name));
  const history=snapshot.model.history.filter(filter);
  const recent=activeEvents(snapshot,actions).filter(r=>r.kind==='medication'&&!['skipped','deferred'].includes(r.status)&&(selected==='all'||r.personId===selected)).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')||Date.parse(b.occurredAt||b.input?.createdAt||0)-Date.parse(a.occurredAt||a.input?.createdAt||0)).filter((r,i,list)=>list.findIndex(x=>x.personId===r.personId&&x.name===r.name)===i).slice(0,4);
  return `<div class="sandbox-history-head"><h2>История${historyDrug&&chosen?' · '+e(names.get(chosen.personId)):''}</h2>${chosen?`<button type="button" data-history-filter aria-pressed="${historyDrug}">${historyDrug?'Все события':'Только '+e(chosen.name)}</button>`:''}</div>${recent.length&&!historyDrug?`<details class="sandbox-recent" open><summary>Последние лекарства</summary>${recent.map(r=>`<p><strong>${e(names.get(r.personId))} · ${e(r.name)}</strong><span>${e(r.detail)} · ${e(measurementStamp(r,calendarDate(),snapshot.timeZone))}</span></p>`).join('')}</details>`:''}<section><h3 class="sr-only">История</h3>${history.length?historyDays(history,names):'<p class="family-empty">Событий нет</p>'}</section>`;
}
function render(focus=false){
  const scroll=root.querySelector('main')?.scrollTop||0,historyScroll=root.querySelector('.sandbox-history')?.scrollTop||0;
  const people=peopleView(),visible=people.filter(p=>selected==='all'?p.current||p.prn.length||snapshot.prescriptions.some(r=>r.personId===p.id):p.id===selected);
  root.innerHTML=`<header class="family-title"><div><span>медика</span><h1>Приёмы</h1></div><button type="button" data-tools>Ещё</button></header><div class="family-toolbar">${careFamily(people,selected)}</div><section class="family-refresh-warning" hidden><p role="status"></p><button type="button" data-retry>Обновить журнал</button></section><main class="care-board sandbox-workspace"><section class="sandbox-plan" id="family-plan" aria-label="Лекарства и назначения"><section id="family-timers" class="family-timers" aria-label="Таймеры связанных препаратов" hidden></section><section id="family-intake-timers" class="family-timers" aria-label="Интервалы между приёмами" hidden></section><div class="care-people">${visible.length?visible.map(card).join(''):emptyMedication('Действующих назначений нет')}</div></section><aside id="sandbox-history" class="sandbox-history care-history" aria-label="История">${historyHTML(people)}</aside></main><footer class="family-preview-footer"><nav class="family-tabs" aria-label="Разделы"><a href="#family-plan">${familyIcon('slots')}<span>Приёмы</span></a><a href="/medicines">${familyIcon('capsule')}<span>Лекарства</span></a><a href="#sandbox-history">${familyIcon('history')}<span>История</span></a><button type="button" data-add-event="">Вручную</button></nav></footer>`;
  if(openKey){const wrapper=[...root.querySelectorAll('[data-demo-row]')].find(n=>n.dataset.demoRow===openKey);if(wrapper)wrapper.querySelector('details').open=true;}
  root.querySelector('main').scrollTop=scroll;root.querySelector('.sandbox-history').scrollTop=historyScroll;
  root.querySelector('.sandbox-plan').insertAdjacentHTML('beforeend',supplyHTML());
  renderRefreshWarning();
  setBusy(saving);updateTimers();
  const selectedFilter=[...root.querySelectorAll('[name="care-person"]')].find(input=>input.value===selected);
  if(selectedFilter){const label=selectedFilter.closest('label'),list=label.parentElement;list.scrollLeft=label.offsetLeft-list.offsetLeft-list.clientWidth/2+label.offsetWidth/2;}
  if(focus)selectedFilter?.focus({preventScroll:true});
}
function supplyHTML(){
  const supply=snapshot.courseSupply||[];
  if(!supply.length)return '';
  const quantity=(amount,unit)=>`${Number(amount).toLocaleString('ru-RU',{maximumFractionDigits:6})} ${unit}`;
  return `<details class="family-supply"><summary>До конца лечения · вся семья</summary><p>Оставшиеся плановые приёмы, включая незаписанные слоты еды. Прошедшие часы исключены.</p>${supply.map(item=>`<section><h3>${e(item.name)}${item.strength?` · ${e(item.strength)}`:''}</h3><strong>${item.incomplete.length?'Посчитано минимум':'Всего нужно'} ${e(quantity(item.total,item.unit))}</strong>${item.people.map(person=>`<p>${e(person.name)} · ${e(quantity(person.amount,item.unit))} · ${person.occurrences} приёмов</p>`).join('')}${item.incomplete.map(person=>`<p class="family-supply-incomplete">${e(person.name)} · ${e(person.reason)}</p>`).join('')}</section>`).join('')}</details>`;
}
function frequencyField(count){
  return `<label>Сколько раз в день<select name="dailyFrequency" aria-label="Сколько раз в день">${options(Array.from({length:12},(_,i)=>[String(i+1),`${i+1} ${i===0?'раз':i<4?'раза':'раз'} в день`]),String(count))}</select></label>`;
}
function intervalFields(rx={}){
  const interval=prescribedInterval(rx);
  return `<fieldset class="family-interval-fields"><legend>Интервал между приёмами</legend><label>Минимальный интервал, ч<input name="minHours" type="number" min="0.01" max="720" step="any" value="${e(interval?.hours||'')}" placeholder="Например, 12"></label><label>Максимум приёмов за 24 ч<input name="maxPer24h" type="number" min="1" max="100" step="1" value="${e(rx.maxPer24h||'')}"></label><p>Заполните по назначению или инструкции. Таймер отсчитывает от фактического приёма.</p></fieldset>`;
}
const options=(values,current)=>values.map(([value,label])=>`<option value="${e(value)}"${value===current?' selected':''}>${e(label)}</option>`).join('');
function eventForm(personId='',row=null,medicationOnly=false){
  if(row)row=effectiveRow(row);const current=row&&rowEvent(snapshot,actions,row);
  const title=row?`${row.name} · факт приёма`:medicationOnly?'Записать приём':'Записать событие';
  const kindField=medicationOnly?'<input type="hidden" name="kind" value="medication">':
    `<label>Что произошло<select name="kind">${options([['temperature','Температура'],['medication','Лекарство'],['retching','Позывы к рвоте'],['vomiting','Рвота'],['diarrhea','Диарея'],['inhalation','Ингаляция'],['other','Другое']],'temperature')}</select></label>`;
  showDialog(title,`<form id="event-form" data-row="${e(row?.key||'')}" data-replaces="${e(current?.id||'')}" data-client-key="${newId()}"><label>Кто<select name="person" required${row?' disabled':''}>${options([['','Выберите человека'],...snapshot.model.cards.map(p=>[p.id,p.name])],row?.personId||personId||(selected!=='all'?selected:''))}</select></label>${row?`<label>Фактическая доза · ${e(row.unit)}<input name="actualAmount" inputmode="decimal" value="${e(current?.input?.actualDose||row.amount)}" required></label>`:`${kindField}<div id="event-values"></div>`}<label>Когда<select name="when">${options([['now','Сейчас'],['ago','Минут назад'],['at','Другое время'],['unknown','Время не помню']],row?'at':'now')}</select></label><div id="event-time"></div><p class="sandbox-form-error" role="alert"></p><button class="sandbox-primary" type="submit">Записать</button></form>`);
  updateValues();updateTime();
}
function manualIntervalField(value=''){
  return `<fieldset class="family-interval-fields"><legend>Таймер до следующего приёма</legend><label>Минимальный интервал, ч<input name="minHours" type="number" min="0.01" max="720" step="any" value="${e(value??'')}" aria-describedby="manual-interval-hint"></label><p id="manual-interval-hint" class="family-setting-note">Укажите интервал по назначению или инструкции. Если поле пустое, используется ранее указанный интервал, когда он есть.</p></fieldset>`;
}
function updateManualInterval(form){
  if(!form?.elements.minHours||form.id!=='event-form')return;
  form.elements.minHours.value=suggestedManualInterval(snapshot,form.elements.person.value,form.elements.eventName.value);
}
function updateValues(){const form=dialog.querySelector('#event-form'),target=form?.querySelector('#event-values');if(!target)return;const kind=form.elements.kind.value;target.innerHTML=kind==='temperature'?'<label>Температура, °C<input name="celsius" inputmode="decimal" required placeholder="37,7"></label>':['medication','inhalation','other'].includes(kind)?`<label>${kind==='other'?'Что произошло':'Название'}<input name="eventName" required list="demo-medicines"></label><datalist id="demo-medicines">${[...new Set([...(snapshot.medicines||[]).map(m=>m.name),...snapshot.prescriptions.map(r=>r.name),...snapshot.model.history.filter(r=>r.kind==='medication').map(r=>r.name)])].map(name=>`<option value="${e(name)}">`).join('')}</datalist>${kind==='medication'?`<div class="sandbox-time-fields"><label>Количество<input name="amount" inputmode="decimal" required></label><label>Единица<select name="unit">${options(['мл','мг','свеча','табл.','капс.','кап.','впрыскивание','пакет','доза','г','мкг','нанесение'].map(u=>[u,u]),'мл')}</select></label></div>${manualIntervalField()}`:kind==='inhalation'?'<label>Состав, объёмы, длительность — что известно<textarea name="detail" rows="3"></textarea></label>':''}`:'';}
function updateTime(){const form=dialog.querySelector('#event-form,#correction-form');if(!form)return;const now=new Date(),date=calendarDate(now);form.querySelector('#event-time').innerHTML=form.elements.when.value==='ago'?'<label>Сколько минут назад<input name="minutes" type="number" min="0" max="10080" required></label>':form.elements.when.value==='unknown'?`<label>Известная дата<input name="date" type="date" value="${e(date)}" required></label>`:form.elements.when.value==='at'?`<div class="sandbox-time-fields"><label>Дата<input name="date" type="date" value="${e(date)}" required></label><label>Время<input name="time" type="time" value="${e(formatTime(now))}" required></label></div>`:'';}
function prescriptionOccurrence(person,slot,i,total,isNew=false){
  const choices=availableMedicineSlots(person).map(s=>[s.anchor,s.label]);
  if(!isNew&&!choices.some(([value])=>value===slot.anchor)&&slot.anchor!=='clock'){const n=['first','second','third'].indexOf(slot.anchor);choices.unshift([slot.anchor,'Текущий: '+(anchors[slot.anchor]||(n>=0?(i+1)+'-й личный приём':'Слот недоступен'))]);}
  return `<div class="family-rx-occurrence" data-rx-occurrence="${i}"${isNew?' data-new-occurrence':''}><label><span data-rx-label>${total===1?'Приём':(i+1)+'-й приём'}</span><select data-rx-anchor name="rxAnchor${i}"${isNew?' required':''}>${options([...(isNew?[['','Выберите слот или время']]:[]),...choices,['clock','Точное время']],slot.anchor)}</select></label><label data-rx-clock>Время<input data-rx-time name="rxTime${i}" type="time" step="60" value="${e(slot.time||'')}" required></label><details class="family-rx-food"><summary>Связь с едой</summary><label>Как принимать<select data-rx-relation>${options(Object.entries(relations),slot.relation||'')}</select></label></details>${isNew?'<button type="button" data-remove-new-occurrence>Убрать новый приём</button>':''}</div>`;
}
function prescriptionScheduleFields(rx){
  if(!['routine','daily'].includes(rx.input.type))return '';
  const person=snapshot.model.cards.find(p=>p.id===rx.personId),slots=rx.input.type==='routine'?rx.input.routineSlots:rx.input.times.map(time=>({anchor:'clock',time}));
  return `<fieldset class="family-rx-schedule"><legend>Когда давать</legend><div data-rx-occurrences>${slots.map((slot,i)=>prescriptionOccurrence(person,slot,i,slots.length)).join('')}</div><button type="button" data-add-occurrence>Добавить приём</button>${frequencyField(slots.length)}</fieldset>`;
}
function addPrescriptionOccurrence(form){
  const rx=rxFor(form.dataset.rx),person=snapshot.model.cards.find(p=>p.id===rx.personId),rows=[...form.querySelectorAll('[data-rx-occurrence]')];if(rows.length>=12)return;
  const mealRelations=rows.map(row=>row.querySelector('[data-rx-relation]')).filter(n=>!n.disabled).map(n=>n.value),relation=mealRelations.length&&mealRelations.every(value=>value===mealRelations[0])?mealRelations[0]:'';
  form.querySelector('[data-rx-occurrences]').insertAdjacentHTML('beforeend',prescriptionOccurrence(person,{anchor:'',relation},rows.length,rows.length+1,true));updatePrescriptionSchedule(form);form.querySelector('[data-rx-occurrence]:last-child [data-rx-anchor]').focus();
}
function updatePrescriptionSchedule(form){
  const rows=[...form.querySelectorAll('[data-rx-occurrence]')];if(!rows.length)return;form.querySelector('[data-add-occurrence]').disabled=rows.length>=12;
  form.elements.dailyFrequency.value=String(rows.length);
  rows.forEach((row,i)=>{row.dataset.rxOccurrence=String(i);row.querySelector('[data-rx-label]').textContent=rows.length===1?'Приём':(i+1)+'-й приём';row.querySelector('[data-rx-anchor]').name='rxAnchor'+i;row.querySelector('[data-rx-time]').name='rxTime'+i;});
  for(const row of rows){const anchor=row.querySelector('[data-rx-anchor]').value,clock=anchor==='clock',time=row.querySelector('[data-rx-time]'),food=row.querySelector('.family-rx-food'),noFood=!anchor||clock||anchor==='bedtime'||anchor==='slot:bedtime';row.querySelector('[data-rx-clock]').hidden=!clock;time.disabled=!clock;food.hidden=noFood;row.querySelector('[data-rx-relation]').disabled=noFood;}
}
function changePrescriptionFrequency(form){
  const count=Number(form.elements.dailyFrequency.value),rx=rxFor(form.dataset.rx),person=snapshot.model.cards.find(p=>p.id===rx.personId);
  const container=form.querySelector('[data-rx-occurrences]'),rows=[...container.children];
  for(const row of rows.slice(count))row.remove();
  for(let i=rows.length;i<count;i++)container.insertAdjacentHTML('beforeend',prescriptionOccurrence(person,{anchor:''},i,count,true));
  updatePrescriptionSchedule(form);
}
// Keep existing occurrence indices stable; new intakes are appended.
function readPrescriptionSchedule(form,rx){
  const rows=[...form.querySelectorAll('[data-rx-occurrence]')];if(!rows.length)return {};
  const routineSlots=rows.map((row,i)=>{const anchor=row.querySelector('[data-rx-anchor]').value,time=row.querySelector('[data-rx-time]').value,relation=row.querySelector('[data-rx-relation]');if(row.hasAttribute('data-new-occurrence')&&!anchor)throw Error('Выберите слот нового приёма');if(anchor==='clock'&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Укажите точное время');return {...(rx.input.routineSlots?.[i]||{}),anchor,relation:relation.disabled?'':relation.value,...(anchor==='clock'?{time}:{})};});
  return {type:'routine',routineSlots,...(rx.input.type==='daily'?{legacyTimes:rx.input.times}:{})};
}
function editor(id){const rx=rxFor(id);if(!rx.id)return;const form=rx.form||rx.suggestedForm,units=form?allowedMedicineUnits(form):[rx.unit].filter(Boolean);showDialog(rx.name+' · назначение',`<p>Изменение назначения не переписывает прошлые приёмы.</p>${courseWarnings(rx,snapshot.model.date).map(w=>`<p class="sandbox-warning">${e(w)}</p>`).join('')}<form id="rx-form" data-rx="${e(id)}" data-version="${rx.version}">${prescriptionScheduleFields(rx)}<label>Разовая доза<input name="dose" inputmode="decimal" value="${e(rx.dose)}" required></label><label>Единица<select name="unit">${options(units.map(u=>[u,u]),rx.unit)}</select></label><p>${e(medicineForms[form]?.name||'Форма не заполнена')}${!rx.form&&rx.suggestedForm?' · определено из текста, требует сверки':''}${rx.strength?' · концентрация '+e(rx.strength):''}</p><div class="sandbox-time-fields"><label>Начало<input type="date" name="startDate" value="${e(rx.startDate)}"></label><label>Окончание<input type="date" name="endDate" value="${e(rx.endDate)}"></label></div>${intervalFields(rx.input)}${rx.source?`<details class="medicine-source"><summary>Запись врача</summary><p>${e(rx.source)}</p></details>`:''}<p class="sandbox-form-error" role="alert"></p><button class="sandbox-primary" type="submit">Сохранить</button></form>`);updatePrescriptionSchedule(dialog.querySelector('#rx-form'));}
function readWhen(form,original=null){
  const when=form.elements.when.value;if(when==='unknown')return {timeUnknown:true,knownDate:form.elements.date?.value||original?.knownDate||calendarDate(new Date()),occurredAt:null};
  if(when==='now')return {timeUnknown:false,occurredAt:new Date().toISOString()};
  if(when==='ago'){const minutes=Number(form.elements.minutes.value);if(!form.elements.minutes.value||!Number.isFinite(minutes)||minutes<0||minutes>10080)throw Error('Укажите от 0 до 10080 минут');return {timeUnknown:false,occurredAt:new Date(Date.now()-minutes*60000).toISOString()};}
  const date=form.elements.date.value,time=form.elements.time.value;
  if(original?.occurredAt&&date===new Date(original.occurredAt).toLocaleDateString('sv-SE',{timeZone:snapshot.timeZone})&&time===formatTime(original.occurredAt))return {timeUnknown:false,occurredAt:original.occurredAt};
  const occurredAt=localInstant(date,time,snapshot.timeZone);if(Date.parse(occurredAt)>Date.now()+60000)throw Error('Событие не может быть в будущем');return {timeUnknown:false,occurredAt};
}
function eventEdit(id){const event=snapshot.model.history.find(r=>r.id===id);if(!event||event.status==='void')return;const raw=event.input;if(event.source==='events'&&event.status!=='taken'){showDialog(event.name,`<p>${e(event.detail)}</p><button type="button" data-cancel="${e(id)}">Отменить запись</button>`);return;}
  showDialog(event.name+' · исправление',`<form id="correction-form" data-id="${e(id)}" data-version="${event.version}"><p>${e(snapshot.model.cards.find(p=>p.id===event.personId)?.name||'')}</p>${event.kind==='temperature'?`<label>Температура, °C<input name="celsius" inputmode="decimal" value="${e(raw.celsius)}" required></label>`:['medication','inhalation'].includes(event.kind)?`<label>Фактическое количество · ${e(raw.unit||'не указано')}<input name="amount" inputmode="decimal" value="${e(raw.actualDose||raw.amount||'')}"${event.source==='events'?' required':''}></label>`:''}${event.source==='activities'&&event.kind==='medication'?manualIntervalField(raw.minHours):''}<label>Примечание<textarea name="note" rows="2">${e(raw.note||'')}</textarea></label><label>Когда<select name="when">${options([['at','Указать время'],['unknown','Время не помню']],event.timeUnknown?'unknown':'at')}</select></label><div id="event-time"></div><p class="sandbox-form-error" role="alert"></p><div class="sandbox-row-actions"><button type="button" data-cancel="${e(id)}">Отменить запись</button><button type="submit" class="sandbox-primary">Сохранить исправление</button></div></form>`);
  updateTime();if(raw.occurredAt){dialog.querySelector('[name=date]').value=new Date(raw.occurredAt).toLocaleDateString('sv-SE',{timeZone:snapshot.timeZone});dialog.querySelector('[name=time]').value=formatTime(raw.occurredAt);}
}
function slotFields(form){const p=snapshot.model.cards.find(p=>p.id===form.elements.person.value),profile=dailyRoutine(p),choices=[['','Не настроено'],...Object.entries(anchors)];form.querySelector('#slot-fields').innerHTML=['first','second','third'].map((name,i)=>`<label>${i+1}-й приём<select name="${name}">${options(choices,profile?.intakes?.[i]||'')}</select></label>`).join('');}
function slotsForm(personId=''){const people=snapshot.model.cards;if(!people.length)return;showDialog('Личные слоты',`<form id="slots-form"><label>Кто<select name="person">${options(people.map(p=>[p.id,p.name]),personId||selected)}</select></label><div id="slot-fields"></div><p>Привязки применяются сразу ко всем лекарствам с 1-м, 2-м и 3-м приёмом.</p><p class="sandbox-form-error" role="alert"></p><button type="submit" class="sandbox-primary">Сохранить</button></form>`);slotFields(dialog.querySelector('form'));}
function treatmentForm(){showDialog('Лечение',`<form id="treatment-form"><label>Кто<select name="person" required>${options([['','Выберите человека'],...snapshot.model.cards.map(p=>[p.id,p.name])],selected==='all'?'':selected)}</select></label><div class="family-treatment-fields" hidden><fieldset class="family-treatment-phases"><legend>Фаза лечения</legend>${[['acute','Острая'],['prevention','Поддерживающая']].map(([key,label])=>`<label class="family-phase-choice"><input type="radio" name="carePhase" value="${key}" required><span>${label}</span></label>`).join('')}</fieldset><section id="treatment-preview" aria-live="polite"></section><p class="family-setting-note">Изменится набор назначений в обзоре. Прошлые записи сохранятся.</p><button type="button" data-slots>Личные слоты</button></div><p class="sandbox-form-error" role="alert"></p><button type="submit" class="sandbox-primary" data-save-treatment>Сохранить</button></form>`);updateTreatment(true);}
function updateTreatment(reset=false){const form=dialog.querySelector('#treatment-form');if(!form)return;const p=snapshot.model.cards.find(p=>p.id===form.elements.person.value),area=form.querySelector('.family-treatment-fields');area.hidden=!p;form.querySelector('[data-save-treatment]').disabled=!p;for(const input of form.querySelectorAll('[name=carePhase]')){input.disabled=!p;if(reset)input.checked=!!p&&input.value===p.phaseKey;}form.querySelector('[data-slots]').disabled=!p;if(!p)return;form.dataset.version=p.version;const phase=form.elements.carePhase.value,ready=snapshot.prescriptions.filter(r=>r.personId===p.id&&r.confirmed&&(!r.phase||r.phase===phase)&&r.startDate<=snapshot.model.date&&(!r.endDate||r.endDate>=snapshot.model.date));form.querySelector('#treatment-preview').innerHTML=!phase?'<p>Выберите фазу лечения.</p>':ready.length?`<h3>Действуют сейчас</h3><ul>${ready.map(r=>`<li>${e(r.name)} · ${e(shortDose(r))}</li>`).join('')}</ul>`:'<p>Назначения для этой фазы ещё не добавлены.</p>';}
function availableMedicineSlots(person){const slots=person.daySlots?profileSlots(person.input):Object.entries(anchors).map(([id,label])=>({id,label}));return slots.map(slot=>({anchor:person.daySlots?'slot:'+slot.id:slot.id,label:slot.label}));}
function medicineActions({medicineActions:personId,anchor,time}){
  showDialog('Лекарство',
    `<div class="family-tools"><button type="button" data-add-intake="${e(personId)}">Записать приём</button><button type="button" data-add-medicine="${e(personId)}" data-anchor="${e(anchor)}" data-time="${e(time)}">Добавить в расписание</button></div>`);
}
function addMedicine(personId='',anchor='',medicineId='',clockTime=''){
  const person=snapshot.model.cards.find(p=>p.id===(personId||selected));
  showDialog('Добавить лекарство',`<form id="add-medicine-form" data-key="${newId()}" data-initial-slot="${e(anchor)}"><label>Кому<select name="personId" required>${options([['','Выберите человека'],...snapshot.model.cards.map(p=>[p.id,p.name])],person?.id||'')}</select></label><label>Лекарство<select name="medicineId" required>${options([['','Выберите препарат'],...snapshot.medicines.filter(m=>!m.archived).sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(m=>[m.id,[m.name,m.strength].filter(Boolean).join(' · ')])],medicineId)}</select></label><div class="sandbox-time-fields"><label>Разовая доза<input name="dose" inputmode="decimal" required autocomplete="off"></label><label>Единица<select name="unit" required></select></label></div><fieldset class="family-slot-picker"><legend>Когда давать</legend><div class="family-schedule-mode">${[['slots','По слотам'],['clock','Точное время']].map(([value,label])=>`<label class="family-slot-choice"><input type="radio" name="scheduleMode" value="${value}"${value===(clockTime?'clock':'slots')?' checked':''}><span>${label}</span></label>`).join('')}</div></fieldset><fieldset id="add-medicine-meals" class="family-slot-picker"><legend class="sr-only">Выберите слоты</legend><div id="add-medicine-slots"></div></fieldset><label id="add-medicine-clock" hidden>Время<input name="clockTime" type="time" step="60" value="${e(clockTime)}" required disabled></label>${frequencyField(1)}<details class="family-prescription-options"><summary>Курс и другие параметры</summary><label>Связь с едой<select name="relation">${options(Object.entries(relations),'')}</select></label><div class="sandbox-time-fields"><label>Начало<input name="startDate" type="date" required value="${e(snapshot.model.date)}"></label><label>Окончание<input name="endDate" type="date"></label></div><label>Фаза<select name="carePhase">${options([['','В обеих фазах'],['acute','Острая'],['prevention','Поддерживающая']],person?.phaseKey||'')}</select></label><label>Указания для этого человека<textarea name="conditions" rows="2" maxlength="2000"></textarea></label><div id="add-medicine-inhalation" hidden><label>Состав смеси · если назначен<textarea name="mixing" rows="2" maxlength="1000"></textarea></label><label>Длительность, минут · если назначена<input name="durationMinutes" type="number" min="1" max="240"></label></div></details>${intervalFields()}<p class="sandbox-form-error" role="alert"></p><button type="submit" class="sandbox-primary">Добавить в расписание</button><a class="family-catalogue-link" href="/medicines">Нет препарата в списке? Добавить по фото</a></form>`);
  updateMedicineSlots(true);updateMedicineUnits();updateMedicineSchedule();
}
function updateMedicineSlots(initial=false){
  const form=dialog.querySelector('#add-medicine-form'),person=snapshot.model.cards.find(p=>p.id===form.elements.personId.value),slots=person?availableMedicineSlots(person):[],anchor=initial?form.dataset.initialSlot:'';
  form.querySelector('#add-medicine-slots').innerHTML=slots.map(slot=>`<label class="family-slot-choice"><input type="checkbox" name="slot" value="${e(slot.anchor)}"${slot.anchor===anchor?' checked':''}><span>${e(slot.label)}</span></label>`).join('')||'<p class="family-setting-note">'+(person?'Сначала добавьте доступные слоты в распорядок человека.':'Выберите человека, чтобы увидеть его слоты.')+'</p>';
  if(!initial)form.elements.carePhase.value=person?.phaseKey||'';
  if(Number(form.elements.dailyFrequency.value)>1&&!form.querySelector('[name=slot]:checked'))updateMedicineFrequency(form);
}
function updateMedicineFrequency(form){
  const count=Number(form.elements.dailyFrequency.value);
  const clock=form.elements.scheduleMode.value==='clock';
  const first=form.querySelector('#add-medicine-clock');
  const old=[...form.querySelectorAll('[data-extra-clock] input')].map(input=>input.value);
  form.querySelectorAll('[data-extra-clock]').forEach(label=>label.remove());
  if(clock){
    first.insertAdjacentHTML('afterend',Array.from({length:count-1},(_,index)=>`<label data-extra-clock>Время ${index+2}-го приёма<input name="clockTime${index+1}" type="time" value="${e(old[index]||'')}" required></label>`).join(''));
    return;
  }
  const choices=[...form.querySelectorAll('[name=slot]')];
  const error=form.querySelector('.sandbox-form-error');
  if(count>choices.length){if(error)error.textContent='Для этого количества выберите точное время или добавьте слоты в распорядок.';return;}
  if(error)error.textContent='';
  const person=snapshot.model.cards.find(p=>p.id===form.elements.personId.value);
  const preferred=dailyRoutine(person).intakes.slice(0,count);
  const usePreferred=preferred.length===count&&preferred.every(anchor=>choices.some(input=>input.value===anchor));
  choices.forEach((input,i)=>input.checked=usePreferred?preferred.includes(input.value):Array.from({length:count},(_,n)=>count===1?0:Math.round(n*(choices.length-1)/(count-1))).includes(i));
}
function updateMedicineSchedule(){
  const form=dialog.querySelector('#add-medicine-form'),clock=form.elements.scheduleMode.value==='clock',meals=form.querySelector('#add-medicine-meals');
  meals.hidden=clock;meals.disabled=clock;form.querySelector('#add-medicine-clock').hidden=!clock;form.elements.clockTime.disabled=!clock;form.elements.relation.disabled=clock;form.elements.relation.closest('label').hidden=clock;
  if(clock)updateMedicineFrequency(form);
  else form.querySelectorAll('[data-extra-clock]').forEach(label=>label.remove());
}
function updateMedicineUnits(){const form=dialog.querySelector('#add-medicine-form'),medicine=snapshot.medicines.find(m=>m.id===form.elements.medicineId.value);form.elements.unit.innerHTML=options(medicine?allowedMedicineUnits(medicine.medicineForm).map(u=>[u,u==='впрыскивание'?'пшик':u]):[],'');form.querySelector('#add-medicine-inhalation').hidden=medicine?.medicineForm!=='inhalation';}
async function saveSlotMedicine(form){
  const person=snapshot.model.cards.find(p=>p.id===form.elements.personId.value),medicine=snapshot.medicines.find(m=>m.id===form.elements.medicineId.value),anchorsSelected=[...form.querySelectorAll('[name=slot]:checked')].map(n=>n.value),dose=form.elements.dose.value.replace(',','.').trim(),relation=form.elements.relation.value,mode=form.elements.scheduleMode.value,clockTime=form.elements.clockTime.value;
  if(!person||!medicine||medicine.archived)throw Error('Выберите человека и препарат');if(!/^\d+(?:\.\d+)?$/.test(dose)||Number(dose)<=0)throw Error('Укажите разовую дозу');if(!['slots','clock'].includes(mode))throw Error('Выберите, когда давать лекарство');if(mode==='slots'&&!anchorsSelected.length)throw Error('Выберите хотя бы один слот');if(mode==='clock'&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clockTime))throw Error('Укажите точное время');
  const slots=availableMedicineSlots(person);if(mode==='slots')for(const anchor of anchorsSelected){const slot=slots.find(s=>s.anchor===anchor);if(!slot)throw Error('Выберите доступный слот');}
  if(mode==='slots'&&anchorsSelected.length!==Number(form.elements.dailyFrequency.value))throw Error('Количество выбранных слотов должно совпадать с кратностью');
  const clockTimes=[clockTime,...[...form.querySelectorAll('[data-extra-clock] input')].map(input=>input.value)];
  if(mode==='clock'&&(clockTimes.some(time=>!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))||new Set(clockTimes).size!==clockTimes.length))throw Error('Укажите разные точные часы для всех приёмов');
  const body={personId:person.id,medicineId:medicine.id,medicineVersion:medicine.version,manualKey:form.dataset.key,name:medicine.name,medicineForm:medicine.medicineForm,strength:medicine.strength,dose,unit:form.elements.unit.value,type:'routine',routineSlots:mode==='clock'?clockTimes.map(time=>({anchor:'clock',time,relation:''})):anchorsSelected.map(anchor=>({anchor,relation})),startDate:form.elements.startDate.value,endDate:form.elements.endDate.value,carePhase:form.elements.carePhase.value,conditions:form.elements.conditions.value,timeZone:snapshot.timeZone,minHours:form.elements.minHours.value,maxPer24h:form.elements.maxPer24h.value,confirmed:true,sourceText:'',documentId:'',regimen:{origin:'manual',...(medicine.medicineForm==='inhalation'?{mixing:form.elements.mixing.value,durationMinutes:form.elements.durationMinutes.value}:{})}};
  const result=await mutate('/prescriptions',body,'POST',{success:'Лекарство добавлено в расписание'});if(result)showPrescription(result.id,person.id);
}

function showPrescription(id,personId,slotIndex=null){
  if(!snapshot||refreshWarning)return;if(selected!=='all'){selected=personId;localStorage.setItem('medika-family-person',selected);}outsideOpen.add(personId);render();const row=baseRows().find(r=>r.prescriptionId===id&&(slotIndex===null||r.slotIndex===slotIndex)),node=[...root.querySelectorAll('[data-demo-row]')].find(n=>n.dataset.demoRow===row?.key)||[...root.querySelectorAll('[data-edit]')].find(n=>n.dataset.edit===id);node?.scrollIntoView({block:'nearest'});
}

let timerAudio;
root.addEventListener('pointerdown',()=>{try{timerAudio||=new(window.AudioContext||window.webkitAudioContext)();timerAudio.resume().catch(()=>{});}catch{}},{capture:true});
function updateTimers(){
  if(!snapshot||refreshWarning)return;
  const now=Date.now(),rows=baseRows();
  for(const node of root.querySelectorAll('[data-intake-row]')){
    const row=rows.find(r=>r.key===node.dataset.intakeRow);
    const timer=row&&intakeTimer(snapshot,row,now);
    node.hidden=!timer;
    node.textContent=timer?[timer.text,timer.detail].filter(Boolean).join(' · '):'';
    node.dataset.state=timer?.state||'';
  }
  const manualPanel=root.querySelector('#family-intake-timers');
  if(manualPanel){
    const timers=manualIntakeTimers(snapshot,selected,now);
    manualPanel.hidden=!timers.length;
    manualPanel.innerHTML=timers.map(timer=>`<p data-manual-intake-state="${timer.state}"><strong>${e(timer.person)} · ${e(timer.name)}</strong><span>${e(timer.text)}</span>${timer.detail?`<small>${e(timer.detail)}</small>`:''}</p>`).join('');
  }
  const active=[];
  for(const row of rows){
    const person=snapshot.model.cards.find(p=>p.id===row.personId);if(!person||!visibleRow(row,person))continue;
    const timer=dependencyTimer(snapshot,actions,row);
    for(const node of root.querySelectorAll('[data-dependency-row]'))if(node.dataset.dependencyRow===row.key){node.textContent=timer?.text||'';node.dataset.state=timer?.state||'';}
    if(!timer||!['waiting','ready','expired'].includes(timer.state))continue;
    active.push(`<p data-timer-state="${timer.state}"><strong>${e(person.name)} · ${e(row.name)}</strong><span>${e(timer.text)}</span><button type="button" data-record="${e(row.key)}"${saving?' disabled':''}>Записать приём</button></p>`);
    if(timer.state==='ready'&&timerAudio?.state==='running'){
      const key='medika-timer:'+timer.key;
      try{if(!sessionStorage.getItem(key)){const oscillator=timerAudio.createOscillator(),gain=timerAudio.createGain();oscillator.connect(gain);gain.connect(timerAudio.destination);oscillator.frequency.value=880;gain.gain.value=.08;oscillator.start();oscillator.stop(timerAudio.currentTime+.3);sessionStorage.setItem(key,'1');}}catch{}
    }
  }
  const panel=root.querySelector('#family-timers');if(panel){panel.hidden=!active.length;panel.innerHTML=active.join('');}
}
setInterval(()=>{if(document.visibilityState==='visible')updateTimers();},1000);

function eventDetail(id){const r=snapshot.model.history.find(r=>r.id===id);if(!r)return;const raw=r.input,person=snapshot.model.cards.find(p=>p.id===r.personId),date=new Date(r.date+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}),dose=['medication','inhalation'].includes(r.kind)&&(raw.actualDose||raw.amount)?shortDose({dose:raw.actualDose||raw.amount,unit:raw.unit}):'';showDialog(r.name,`${fields([['Кто',person?.name||''],['Когда',date+' · '+(r.occurredAt?formatTime(r.occurredAt):'время неизвестно')],...(dose?[['Количество',dose]]:[]),...(raw.minHours?[['Интервал отсчёта',Number(raw.minHours).toLocaleString('ru-RU')+' ч']]:[]),['Статус',({taken:'Принято',recorded:'Записано',void:'Отменено',skipped:'Пропущено',deferred:'Отложено'}[r.status]||r.status)]])}${raw.note?`<section><h3>Примечание</h3><p>${e(raw.note)}</p></section>`:''}${raw.voidReason?`<section><h3>Причина отмены</h3><p>${e(raw.voidReason)}</p></section>`:''}${raw.sourceText?`<details class="medicine-source"><summary>Исходная фраза</summary><p>${e(raw.sourceText)}</p></details>`:''}${r.status!=='void'?`<div class="sandbox-row-actions">${r.source!=='events'||r.status==='taken'?`<button type="button" data-edit-event="${e(id)}">Исправить</button>`:''}<button type="button" data-cancel="${e(id)}">Отменить запись</button></div>`:''}`);}
function tools(){showDialog('Ещё',`<nav class="family-tools"><button type="button" data-add-medicine="">Добавить в расписание</button><a href="/medicines">Лекарства</a>${snapshot.account?'<a href="/account">Аккаунт</a>':''}<label class="family-theme-choice">Тема расписания<select id="family-theme">${options(familyThemes.map(({id,name})=>[id,name]),document.body.dataset.theme)}</select></label><button type="button" data-treatment>Лечение</button><button type="button" data-phrase>Событие текстом</button><a href="/prescriptions/import">Разобрать выписку</a><a href="/manage">Все настройки и документы</a></nav><details class="family-test-tools"><summary>Тестовые инструменты</summary><nav class="family-tools"><a href="/playground">Проверка OCR и дизайна</a></nav></details>`);}
function draftForm(draft){eventForm(draft.personId||'');const form=dialog.querySelector('form');form.dataset.sourceText=draft.sourceText||'';form.dataset.relatedRxId=draft.relatedRxId||'';form.elements.kind.value=draft.kind;updateValues();if(form.elements.celsius)form.elements.celsius.value=draft.celsius??'';if(form.elements.eventName){form.elements.eventName.value=draft.name||'';updateManualInterval(form);}if(form.elements.amount)form.elements.amount.value=draft.amount||'';if(form.elements.unit)form.elements.unit.value=draft.unit||'';form.elements.when.value=draft.occurredAt?'at':'unknown';updateTime();if(draft.occurredAt){form.elements.date.value=new Date(draft.occurredAt).toLocaleDateString('sv-SE',{timeZone:snapshot.timeZone});form.elements.time.value=formatTime(draft.occurredAt);}if(draft.notes?.length)form.querySelector('.sandbox-form-error').textContent=draft.notes.join(' ');}
function updateFooterOffset(){
  const footer=root.querySelector('.family-preview-footer');
  if(footer)notice.style.bottom=`${Math.ceil(footer.getBoundingClientRect().height)+8}px`;
}
root.addEventListener('change',event=>{if(saving||loading)return;if(event.target.name==='care-person'){selected=event.target.value;root.querySelector('main').scrollTop=0;localStorage.setItem('medika-family-person',selected);openKey='';historyDrug=false;render(true);}else if(event.target.matches('[data-take]')){const row=baseRows().find(r=>r.key===event.target.dataset.take);if(!row)return;const old=rowEvent(snapshot,actions,row),checked=event.target.checked;event.target.checked=Boolean(old);if(checked)record(row);else if(old)cancel(old.id);}});
root.addEventListener('toggle',event=>{if(event.target.hasAttribute('data-outside-plans')){if(event.target.open)outsideOpen.add(event.target.dataset.outsidePlans);else outsideOpen.delete(event.target.dataset.outsidePlans);return;}if(!event.target.parentElement?.classList.contains('care-med'))return;const key=event.target.closest('[data-demo-row]')?.dataset.demoRow;if(event.target.open){openKey=key;root.querySelectorAll('.care-med>details[open]').forEach(n=>{if(n!==event.target)n.open=false;});}else if(openKey===key){openKey='';historyDrug=false;}else return;root.querySelectorAll('[data-demo-row]').forEach(n=>n.classList.toggle('is-selected',n.dataset.demoRow===openKey));root.querySelector('.sandbox-history').innerHTML=historyHTML();},true);
root.addEventListener('click',event=>{const target=event.target.closest('button');if(!target||saving)return;
  if(target.hasAttribute('data-tools'))tools();if(target.hasAttribute('data-retry'))load();if(target.hasAttribute('data-medicine-info'))medicineInfo(target.dataset.medicineInfo);
  if(target.hasAttribute('data-medicine-actions'))medicineActions(target.dataset);
  if(target.hasAttribute('data-record')){const row=baseRows().find(r=>r.key===target.dataset.record),old=rowEvent(snapshot,actions,row);if(old||row.eventId)eventEdit(old?.id||row.eventId);else if(row.anchor==='unassigned')slotsForm();else eventForm('',row);}
  if(target.hasAttribute('data-edit'))editor(target.dataset.edit);if(target.hasAttribute('data-add-event'))eventForm(target.dataset.addEvent);if(target.hasAttribute('data-open-event'))eventDetail(target.dataset.openEvent);
  if(target.hasAttribute('data-history-filter')){historyDrug=!historyDrug;root.querySelector('.sandbox-history').innerHTML=historyHTML();}
});
notice.addEventListener('click',event=>{const target=event.target.closest('[data-undo]');if(target&&!saving)cancel(target.dataset.undo);});
dialog.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target||saving)return;
  try{
    if(target.hasAttribute('data-add-intake')){dialog.close();eventForm(target.dataset.addIntake,null,true);return;}
    if(target.hasAttribute('data-add-medicine')){dialog.close();addMedicine(target.dataset.addMedicine,target.dataset.anchor||'','',target.dataset.time||'');return;}
    if(target.hasAttribute('data-close'))dialog.close();if(target.hasAttribute('data-add-occurrence'))addPrescriptionOccurrence(target.form);if(target.hasAttribute('data-remove-new-occurrence')){const form=target.form;target.closest('[data-new-occurrence]').remove();updatePrescriptionSchedule(form);}if(target.hasAttribute('data-slots')){const personId=dialog.querySelector('#treatment-form')?.elements.person.value||'';dialog.close();slotsForm(personId);}if(target.hasAttribute('data-treatment')){dialog.close();treatmentForm();}if(target.hasAttribute('data-edit-event'))eventEdit(target.dataset.editEvent);if(target.hasAttribute('data-cancel'))cancel(target.dataset.cancel);if(target.hasAttribute('data-phrase')){dialog.close();showDialog('Событие текстом','<form id="phrase-form"><label>Имя, событие, когда<textarea name="text" required rows="3"></textarea></label><p class="sandbox-form-error" role="alert"></p><button type="submit" class="sandbox-primary">Проверить</button></form>');}
  }catch(error){message(error.message);}
});
dialog.addEventListener('change',event=>{
  if (event.target.id === 'family-theme') {
    localStorage.setItem('medika-family-theme', setTheme(event.target.value));
    return;
  }
if(event.target.hasAttribute('data-rx-anchor'))updatePrescriptionSchedule(event.target.form);if(event.target.name==='dailyFrequency'&&event.target.form?.id==='rx-form')changePrescriptionFrequency(event.target.form);if(event.target.form?.id==='add-medicine-form'){if(event.target.name==='personId')updateMedicineSlots();if(event.target.name==='medicineId')updateMedicineUnits();if(event.target.name==='scheduleMode')updateMedicineSchedule();if(event.target.name==='dailyFrequency')updateMedicineFrequency(event.target.form);if(event.target.name==='slot'){const count=event.target.form.querySelectorAll('[name=slot]:checked').length;if(count)event.target.form.elements.dailyFrequency.value=String(count);}}if(event.target.closest('#treatment-form')&&['person','carePhase'].includes(event.target.name))updateTreatment(event.target.name==='person');if(event.target.name==='kind')updateValues();if(event.target.name==='when')updateTime();const form=event.target.closest('#slots-form');if(form&&event.target.name==='person')slotFields(form);if(event.target.name==='person'&&event.target.form?.id==='event-form'){event.target.form.dataset.relatedRxId='';updateManualInterval(event.target.form);}});
dialog.addEventListener('input',event=>{if(event.target.name==='eventName'){event.target.form.dataset.relatedRxId='';updateManualInterval(event.target.form);}});
dialog.addEventListener('submit',async event=>{event.preventDefault();if(saving)return;const form=event.target;try{
  if(form.id==='add-medicine-form'){await saveSlotMedicine(form);return;}
  if(form.id==='phrase-form'){saving=true;setBusy(true);try{const draft=await api('/parse-entry',{text:form.elements.text.value,personId:'',timeZone:snapshot.timeZone});dialog.close();draftForm(draft);}finally{saving=false;setBusy(false);}return;}
  if(form.id==='treatment-form'){const p=snapshot.model.cards.find(p=>p.id===form.elements.person.value),carePhase=form.elements.carePhase.value;if(!p||!['acute','prevention'].includes(carePhase))throw Error('Выберите человека и фазу');if(carePhase===p.phaseKey){dialog.close();return;}openKey='';historyDrug=false;await mutate('/people/'+p.id,{...p.input,carePhase,version:Number(form.dataset.version)},'PUT',{success:'Фаза лечения сохранена'});return;}
  if(form.id==='slots-form'){const p=snapshot.model.cards.find(p=>p.id===form.elements.person.value),profile=dailyRoutine(p),intakes=[form.elements.first.value,form.elements.second.value,form.elements.third.value],routine=Object.fromEntries(['weekday','weekend'].map(kind=>[kind,{...profile,intakes}]));await mutate('/people/'+p.id,{...p.input,routine,version:p.version},'PUT',{success:'Личные слоты сохранены'});return;}
  if(form.id==='rx-form'){const rx=rxFor(form.dataset.rx),dose=form.elements.dose.value.replace(',','.').trim(),unit=form.elements.unit.value;if(!/^\d+(?:\.\d+)?$/.test(dose)||Number(dose)<=0)throw Error('Укажите положительную дозу');if(['впрыскивание','кап.'].includes(unit)&&!Number.isInteger(Number(dose)))throw Error('Нужно целое количество');const added=[...form.querySelectorAll('[data-new-occurrence]')],focusSlotIndex=added.length?Number(added.at(-1).dataset.rxOccurrence):null;const result=await mutate('/prescriptions/'+rx.id,{...rx.input,...readPrescriptionSchedule(form,rx),dose,unit,minHours:form.elements.minHours.value,maxPer24h:form.elements.maxPer24h.value,startDate:form.elements.startDate.value,endDate:form.elements.endDate.value,ingredients:rx.input.ingredients.join(' + '),times:rx.input.times.join(', '),version:Number(form.dataset.version)},'PUT',{success:'Назначение сохранено'});if(result)showPrescription(result.id,rx.personId,focusSlotIndex);return;}
  if(form.id==='correction-form'){const entry=snapshot.model.history.find(r=>r.id===form.dataset.id);const changes={...readWhen(form,entry.input),version:Number(form.dataset.version),note:form.elements.note.value,...(form.elements.celsius?{celsius:form.elements.celsius.value}:{}),...(form.elements.amount?{amount:form.elements.amount.value.replace(',','.')}:{}),...(form.elements.minHours?{minHours:form.elements.minHours.value}:{})};await mutate('/'+entry.source+'/'+entry.id+'/correct',changes,'POST',{success:'Исправление сохранено'});return;}
  if(form.id!=='event-form')return;const when=readWhen(form),row=baseRows().find(r=>r.key===form.dataset.row);
  if(row){const amount=form.elements.actualAmount.value.replace(',','.');if(!amount.trim()||!(Number(amount)>0))throw Error('Укажите фактическую дозу');await record(row,when.occurredAt,when.timeUnknown,amount,form.dataset.clientKey,when.knownDate);return;}
  const kind=form.elements.kind.value,labels={retching:'Позывы к рвоте',vomiting:'Рвота',diarrhea:'Диарея'},personId=form.elements.person.value;if(!personId)throw Error('Выберите человека');
  const body={personId,kind,...when,timeZone:snapshot.timeZone,clientKey:form.dataset.clientKey,sourceText:form.dataset.sourceText||'',...(form.dataset.relatedRxId?{relatedRxId:form.dataset.relatedRxId}:{}),name:labels[kind]||form.elements.eventName?.value.trim()||'Температура',...(kind==='temperature'?{celsius:form.elements.celsius.value}:{}),...(kind==='medication'&&form.elements.minHours.value?{minHours:form.elements.minHours.value}:{}),...(['medication','inhalation'].includes(kind)?{amount:form.elements.amount?.value.replace(',','.')||'',unit:form.elements.unit?.value||'',note:form.elements.detail?.value.trim()||''}:{})};await mutate('/activities',body,'POST',{success:'Событие записано',undo:true});
}catch(error){const field=form.querySelector('.sandbox-form-error');if(field)field.textContent=error.message;else message(error.message);}});
window.addEventListener('resize',updateFooterOffset);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')load();});
setInterval(()=>{if(document.visibilityState==='visible')load();},30000);
load().then(()=>{
  const params=new URLSearchParams(location.search),medicineId=params.get('medicine');
  if(medicineId){addMedicine(params.get('person')||'','',medicineId);history.replaceState(null,'',location.pathname);}
});
