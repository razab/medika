import {captureVoice} from '/voice-capture.js';
const $=(s,r=document)=>r.querySelector(s),root=$('#app'),modal=$('#modal');
let state,token='',patientId=localStorage.getItem('medika-patient')||'',phrase='',busy=false,recording=null,voiceAt='',textEntry=false,language=localStorage.getItem('medika-language')||'ru';
const kinds={temperature:'Температура',diarrhea:'Диарея',vomiting:'Рвота',retching:'Позывы к рвоте',inhalation:'Ингаляция',medication:'Лекарство',other:'Другое'};
const phases={'':'Не выбран',prevention:'Профилактика',acute:'Острая фаза'};
const units=['мл','мг','свеча','табл.','капс.','кап.','впрыскивание','пакет','доза','г','мкг','нанесение'];
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=p=>p?.displayName||p?.name||'';
const person=id=>state.people.find(p=>p.id===id),current=()=>person(patientId);
const tz=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'Europe/Chisinau';
const key=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const value=r=>r.celsius.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:2})+' °C';
const time=r=>new Date(r.occurredAt).toLocaleTimeString('ru-RU',{timeZone:r.timeZone,hour:'2-digit',minute:'2-digit'});
const date=r=>new Date(r.occurredAt).toLocaleDateString('ru-RU',{timeZone:r.timeZone,day:'numeric',month:'long',year:'numeric'});
function localInput(iso=new Date().toISOString()){if(!iso)return '';const d=new Date(iso);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,16);}
function toast(text,record=null){
  const node=$('#toast');node.textContent=text;clearTimeout(toast.timer);
  if(record){const button=document.createElement('button');button.textContent='Отменить';button.onclick=async()=>{button.disabled=true;try{await api('/activities/'+record.id+'/void',{body:{version:record.version,reason:'Отменено после голосового ввода'}});await refresh();toast('Запись отменена');}catch(error){toast(error.message);}};node.append(button);}
  toast.timer=setTimeout(()=>node.textContent='',record?15000:5000);
}
async function api(path,{body,method=body?'POST':'GET',retry=false}={}){
  if(!token){const r=await fetch('/api/session');if(!r.ok)throw Error('Приложение недоступно');token=(await r.json()).token;}
  const response=await fetch('/api'+path,{method,headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  if(response.status===403&&!retry){token='';return api(path,{body,method,retry:true});}
  const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось сохранить');return result;
}
function records(id=patientId){
  return [...(state.activities||[]).map(r=>({...r,source:'activities'})),...(state.temperatures||[]).map(r=>({...r,kind:'temperature',source:'temperatures'})),...state.events.map(r=>({...r,kind:'medication',source:'events',amount:r.actualDose||r.dose}))].filter(r=>r.personId===id).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||b.createdAt.localeCompare(a.createdAt));
}
function title(r){return r.kind==='temperature'?value(r):r.kind==='inhalation'?'Ингаляция · '+r.name:r.name||kinds[r.kind];}
function amount(r){return [r.amount,r.unit,r.doseScope==='each-nostril'?'в каждую ноздрю':''].filter(Boolean).join(' ');}
async function refresh(){
  state=await api('/state');
  if(!person(patientId)){const latest=[...(state.activities||[]),...(state.temperatures||[]),...state.events].sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt))[0];patientId=latest?.personId||state.people.find(p=>p.name==='Алиса')?.id||state.people[0]?.id||'';}
  if(patientId)localStorage.setItem('medika-patient',patientId);render();
}
function render(){
  if(!state.people.length){root.innerHTML='<main class="start"><h1>Медика</h1><button data-act="person">Добавить пациента</button></main>';return;}
  const p=current(),all=records(),active=all.filter(r=>r.status!=='void'),cancelled=all.filter(r=>r.status==='void'),last=active.find(r=>r.kind==='temperature');
  root.innerHTML=`<div class="patient-app"><header class="patient-nav" aria-label="Пациенты">${state.people.map(p=>`<button data-patient="${p.id}" aria-pressed="${p.id===patientId}" ${busy||recording?'disabled':''}>${e(label(p))}</button>`).join('')}<button class="more" data-act="tools" aria-label="Ещё">⋯</button></header><section class="patient-summary"><h1>${e(label(p))}${p.ageYears!=null?`<small>${p.ageYears} лет</small>`:''}</h1>${last?`<span class="last-temperature">${value(last)} <time>${time(last)}</time></span>`:''}</section><details class="doctor"><summary>Врач <span>${e(phases[p.carePhase||''])}</span></summary><div class="doctor-body"><label>Контекст<select id="care-phase">${Object.entries(phases).map(([v,l])=>`<option value="${v}" ${v===(p.carePhase||'')?'selected':''}>${l}</option>`).join('')}</select></label>${doctorPlan()}<div class="source-actions"><button data-act="upload">Выписка</button><button data-act="rx">Назначение</button></div></div></details><main class="patient-history" aria-label="История пациента">${active.length?historyRows(active):'<p class="quiet">Событий пока нет</p>'}${cancelled.length?`<details class="cancelled"><summary>Отменённые · ${cancelled.length}</summary>${historyRows(cancelled)}</details>`:''}</main><form id="composer" class="composer" aria-label="Общее событие для семьи"><div class="composer-actions"><button type="button" class="voice ${recording?'recording':''}" data-act="voice" ${busy?'disabled':''}>${recording?'■ Отправить':'● Событие голосом'}</button><select id="language" aria-label="Язык диктовки" ${busy||recording?'disabled':''}><option value="ru" ${language==='ru'?'selected':''}>RU</option><option value="en" ${language==='en'?'selected':''}>EN</option></select><button type="button" class="text-toggle" data-act="text" ${busy||recording?'disabled':''}>Текстом</button></div><div class="voice-status" role="status">${busy?'Распознаю и записываю…':recording?'Скажите имя и событие · пауза отправит запись':'Имя, что произошло, сколько минут назад'}</div>${textEntry?`<div class="text-entry"><textarea id="phrase" name="text" rows="1" placeholder="Даня, две минуты назад температура 38,2" aria-label="Запись одной фразой" ${busy||recording?'disabled':''}>${e(phrase)}</textarea><button type="submit" class="primary" ${busy||recording?'disabled':''}>Проверить</button></div>`:''}</form></div>`;
  $('#composer').onsubmit=event=>{event.preventDefault();parsePhrase();};
  if($('#phrase'))$('#phrase').oninput=event=>phrase=event.target.value;
  $('#language').onchange=event=>{language=event.target.value;localStorage.setItem('medika-language',language);};
  $('#care-phase').onchange=async event=>{try{await api('/people/'+p.id,{method:'PUT',body:{...p,carePhase:event.target.value,version:p.version}});await refresh();$('.doctor').open=true;}catch(error){toast(error.message);}};
}
function historyRows(rows){
  let previous='';return rows.map(r=>{const day=date(r),heading=day!==previous?`<h2 class="day">${e(day)}</h2>`:'';previous=day;return `${heading}<details class="record ${r.status==='void'?'void':''}" data-record="${r.id}"><summary><time>${time(r)}</time><div><strong>${e(title(r))}</strong>${amount(r)?`<b>${e(amount(r))}</b>`:''}${r.status==='skipped'?'<span>Пропущено</span>':r.status==='deferred'?'<span>Отложено</span>':''}</div></summary><div class="record-details">${r.carePhase?`<p>${e(phases[r.carePhase])}</p>`:''}${r.relatedRxId?`<p>Связано с назначением: ${e(state.prescriptions.find(x=>x.id===r.relatedRxId)?.name||'из истории')}</p>`:''}${r.strength?`<p>${e(r.strength)}</p>`:''}${r.note?`<p>${e(r.note)}</p>`:''}${r.sourceText?`<p class="source-text">${e(r.sourceText)}</p>`:''}${r.status==='void'?`<p>Отменено: ${e(r.voidReason)}</p>`:`<button data-act="void" data-source="${r.source}" data-id="${r.id}">Отменить запись</button>`}</div></details>`;}).join('');
}
function doctorPlan(){
  const phase=current().carePhase||'',rxs=state.prescriptions.filter(r=>r.personId===patientId&&!r.archived&&(!phase||!r.carePhase||r.carePhase===phase));
  const suggestions=state.documents.filter(d=>d.personId===patientId&&d.sourceKind!=='household').flatMap(d=>d.suggestions.map((s,index)=>({s,d,index}))).filter(({s,d})=>(!phase||(s.conditions?.includes('Условная схема')?'acute':'prevention')===phase)&&!state.prescriptions.some(r=>r.documentId===d.id&&r.sourceText===s.sourceText));
  const rows=rxs.map(r=>`<div class="order"><div><strong>${e(r.name)}</strong><b>${e(r.dose)} ${e(r.unit)}${r.doseScope==='each-nostril'?' в каждую ноздрю':''}</b><span>${e(r.type==='prn'?'По необходимости':r.times?.join(' · ')||r.conditions||'По назначению')}</span></div><button data-act="rx" data-id="${r.id}">Изменить</button></div>`).join('');
  const drafts=suggestions.map(({s,d,index})=>`<div class="order draft"><div><strong>${e(s.name)}</strong><b>${s.dose?e(s.dose)+' '+e(s.unit)+(s.doseScope==='each-nostril'?' в каждую ноздрю':''):'Доза не уточнена'}</b><span>${e(s.times||s.conditions||'Время не уточнено')}</span><small>Из выписки · сверить</small></div><button data-act="draft-rx" data-id="${d.id}" data-index="${index}">Сверить</button></div>`).join('');
  const docs=state.documents.filter(d=>d.personId===patientId);
  return rows+drafts+(!rows&&!drafts?'<p class="quiet">Назначений пока нет</p>':'')+`<details class="sources"><summary>Оригиналы · ${docs.length}</summary>${docs.map(d=>`<button data-act="document" data-id="${d.id}">${e(d.name)}</button>`).join('')}</details>`;
}
function field(label,name,value='',extra=''){return `<label>${label}<input name="${name}" value="${e(value)}" ${extra}></label>`;}
function footer(label='Сохранить'){return `<footer class="dialog-footer"><button type="button" data-close>Отмена</button><button type="submit" class="primary">${label}</button></footer>`;}
function dialog(title,html,submit){
  modal.innerHTML=`<header class="dialog-head"><h2 id="modal-title">${e(title)}</h2><button data-close aria-label="Закрыть">×</button></header><form>${html}<p class="error" role="alert"></p></form>`;if(!modal.open)modal.showModal();
  $('form',modal).onsubmit=async event=>{event.preventDefault();const button=$('[type="submit"]',modal);if(button?.disabled)return;if(button)button.disabled=true;try{await submit?.(Object.fromEntries(new FormData(event.target)),event.target);}catch(error){$('.error',modal).textContent=error.message;}finally{if(button)button.disabled=false;}};
}
modal.addEventListener('click',event=>{if(event.target.closest('[data-close]'))modal.close();});
async function parsePhrase(text=phrase,pid=''){
  if(!text.trim()||busy)return;busy=true;render();
  try{const draft=await api('/parse-entry',{body:{text,personId:pid,timeZone:tz()}});preview(draft);}catch(error){toast(error.message);}finally{busy=false;render();}
}
function preview(d){
  const clientKey=key(),rxs=state.prescriptions.filter(r=>r.personId===d.personId);
  dialog('Проверить запись',`<div class="preview"><label>Кто<select name="personId" required><option value="">Выберите пациента</option>${state.people.map(p=>`<option value="${p.id}" ${p.id===d.personId?'selected':''}>${e(label(p))}</option>`).join('')}</select></label><label>Что<select name="kind">${Object.entries(kinds).map(([v,l])=>`<option value="${v}" ${v===d.kind?'selected':''}>${l}</option>`).join('')}</select></label><div data-part="temperature">${field('Температура, °C','celsius',d.celsius,'inputmode="decimal"')}</div><div data-part="medication inhalation other">${field('Лекарство / действие','name',d.name,'maxlength="200"')}</div><div class="dose-fields" data-part="medication inhalation">${field('Количество · если известно','amount',d.amount,'inputmode="decimal"')}<label>Единица<select name="unit"><option value="">Не указана</option>${units.map(u=>`<option ${u===d.unit?'selected':''}>${u}</option>`).join('')}</select></label></div>${field('Когда · время этого устройства','occurredAt',localInput(d.occurredAt),'type="datetime-local" required')}<details><summary>Предписание и исходная фраза</summary><label>Контекст<select name="carePhase">${Object.entries(phases).map(([v,l])=>`<option value="${v}" ${v===d.carePhase?'selected':''}>${l}</option>`).join('')}</select></label><label>Связь с назначением<select name="relatedRxId"><option value="">Вне назначения</option>${rxs.map(r=>`<option value="${r.id}" ${r.id===d.relatedRxId?'selected':''}>${e(r.name)}</option>`).join('')}</select></label>${field('Концентрация / содержание','strength',d.strength,'maxlength="150"')}<p class="source-text">${e(d.sourceText)}</p></details>${d.notes.length?`<p class="parse-notes">${d.notes.map(e).join('<br>')}</p>`:''}</div>${footer('Записать')}`,async data=>{
    const body={...data,sourceText:d.sourceText,timeZone:d.timeZone,occurredAt:new Date(data.occurredAt).toISOString(),clientKey};
    if(data.kind!=='temperature')delete body.celsius;
    if(!['medication','inhalation'].includes(data.kind)){body.amount='';body.unit='';body.relatedRxId='';}
    const record=await api('/entries',{body});patientId=record.personId;phrase='';textEntry=false;modal.close();await refresh();toast('Записано');
  });
  const choose=$('[name="kind"]',modal),update=()=>{for(const part of modal.querySelectorAll('[data-part]')){const visible=part.dataset.part.split(' ').includes(choose.value);part.hidden=!visible;for(const input of part.querySelectorAll('input,select'))input.disabled=!visible;} $('[name="celsius"]',modal).required=choose.value==='temperature';$('[name="name"]',modal).required=['medication','inhalation','other'].includes(choose.value);};choose.onchange=update;update();
  $('[name="personId"]',modal).onchange=()=>{const select=$('[name="relatedRxId"]',modal);select.value='';for(const option of [...select.options].slice(1))option.remove();};
  $('[name="name"]',modal).oninput=()=>{$('[name="relatedRxId"]',modal).value='';};
}
async function recordSpeech(text,recordedAt,clientKey){
  const result=await api('/record-entry',{body:{text,timeZone:tz(),recordedAt,clientKey}});
  if(!result.record){preview(result.draft);return;}
  const record=result.record;patientId=record.personId;phrase='';textEntry=false;localStorage.setItem('medika-patient',patientId);await refresh();
  toast(label(person(record.personId))+' · '+title(record)+(amount(record)?' · '+amount(record):'')+' · '+time(record),record);
}
async function speechFile(file,recordedAt=new Date().toISOString()){
  if(!file||busy)return;busy=true;render();const clientKey=key();
  try{const audio=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const result=await api('/transcribe',{body:{audio,language}});phrase=result.text;await recordSpeech(result.text,recordedAt,clientKey);}catch(error){textEntry=!!phrase;toast(error.message);}finally{busy=false;render();}
}
async function voice(){
  if(busy)return;
  if(recording){const captured=recording;recording=null;busy=true;render();try{const blob=await captured.stop();busy=false;await speechFile(blob,voiceAt);}catch(error){toast(error.message);}finally{busy=false;render();}return;}
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){voiceHelp();return;}
  if(!state.capabilities.voice?.ready){toast('Локальное распознавание ещё не готово');return;}
  busy=true;phrase='';render();
  try{recording=await captureVoice(()=>voice());voiceAt=new Date().toISOString();}catch(error){toast(error.name==='NotAllowedError'?'Разрешите доступ к микрофону в браузере':'Не удалось включить микрофон. Можно ввести текст или выбрать аудиозапись.');}finally{busy=false;render();}
}
function voiceHelp(){dialog('Микрофон на телефоне',`<p>Браузер разрешает микрофон через HTTPS. На iPad один раз установите локальный сертификат и включите доверие к нему.</p><ol><li><a href="/medika-ca.cer">Скачать сертификат Медики</a></li><li>Настройки → Загруженный профиль → Установить. Затем Основные → Об этом устройстве → Доверие сертификатам → включить локальный сертификат.</li><li><a href="${e(state.capabilities.voice?.secureOrigin||'https://macbook-air-5.local')}">Открыть HTTPS</a></li></ol><p class="quiet">Сейчас можно надиктовать текст микрофоном клавиатуры или выбрать готовую аудиозапись. Распознавание записи выполняется на Mac.</p><input type="file" id="audio-file" accept=".wav,.m4a,.mp4,.aif,.aiff" aria-label="Аудиозапись"><footer class="dialog-footer"><button type="button" data-close>Закрыть</button></footer>`);$('#audio-file',modal).onchange=event=>{modal.close();speechFile(event.target.files[0]);};}
function template(){dialog('Шаблон фразы',`<p class="template-line">Кто → что сделали → сколько → когда</p><p>Можно говорить свободно. Одно событие — одна фраза. Неясные поля можно исправить перед записью.</p><footer class="dialog-footer"><button type="button" data-close>Понятно</button></footer>`);}
function personForm(p=current()){
  dialog(p?'Пациент':'Новый пациент',`${field('Имя','name',p?.name||'','required maxlength="100"')}${field('Возраст, лет · необязательно','ageYears',p?.ageYears??'','type="number" min="0" max="130"')}${footer()}`,async data=>{const result=await api('/people'+(p?'/'+p.id:''),{method:p?'PUT':'POST',body:{...p,...data,displayName:data.name,ageAsOf:p?.ageAsOf||new Date().toLocaleDateString('sv-SE',{timeZone:tz()}),version:p?.version}});patientId=result.id;modal.close();await refresh();});
}
function tools(){dialog('Данные пациента',`<div class="tools"><button type="button" data-tool="edit">Изменить пациента</button><button type="button" data-tool="add">Добавить пациента</button><button type="button" data-tool="backup">Резервная копия</button><label>Восстановить копию<input type="file" id="restore-file" accept="application/json,.json"></label><button type="button" data-tool="audio">Выбрать аудиозапись</button></div>`);modal.querySelectorAll('[data-tool]').forEach(b=>b.onclick=async()=>{try{if(b.dataset.tool==='edit')personForm();if(b.dataset.tool==='add')personForm(null);if(b.dataset.tool==='audio')voiceHelp();if(b.dataset.tool==='backup'){const backup=await api('/backup'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}));a.download='medika-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}}catch(error){toast(error.message);}});$('#restore-file',modal).onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>64*1024*1024)throw Error('Копия больше 64 МБ');await api('/restore',{body:JSON.parse(await file.text())});modal.close();await refresh();toast('Копия восстановлена');}catch(error){$('.error',modal).textContent=error.message;}};}
function voidRecord(source,id){const r=records().find(r=>r.id===id&&r.source===source);dialog('Отменить запись',`<p>${e(title(r))} · ${time(r)}</p><label>Причина<textarea name="reason" required maxlength="1000"></textarea></label>${footer('Отменить запись')}`,async data=>{await api('/'+source+'/'+id+'/void',{body:{reason:data.reason,version:r.version}});modal.close();await refresh();});}
function documentView(id){const d=state.documents.find(d=>d.id===id);dialog(d.name,`${d.mime?`<img class="document-image" src="/api/documents/${d.id}/image" alt="Оригинал выписки">`:''}<p class="source-text">${e(d.text)}</p>${d.reviewNotes?`<p class="source-text">${e(d.reviewNotes)}</p>`:''}<footer class="dialog-footer"><button type="button" data-close>Закрыть</button></footer>`);}
function upload(){dialog('Выписка · '+label(current()),'<label>Фото или текст<input type="file" name="file" accept="image/png,image/jpeg,image/webp"></label><label>Текст<textarea name="text" maxlength="50000"></textarea></label>'+footer('Добавить'),async(data,form)=>{const file=$('[name="file"]',form).files[0];let image;if(file)image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});await api('/documents',{body:{personId:patientId,name:file?.name||'Рекомендация врача',sourceKind:'doctor',...(image?{image}:{text:data.text})}});modal.close();await refresh();$('.doctor').open=true;});}
function rxForm(id='',suggestion={},documentId=''){
  const r=state.prescriptions.find(r=>r.id===id)||suggestion,p=current();
  dialog('Назначение врача',`${field('Препарат','name',r.name,'required maxlength="200"')}<div class="dose-fields">${field('Доза','dose',r.dose,'inputmode="decimal" required')}<label>Единица<select name="unit">${units.map(u=>`<option ${u===(r.unit||'мл')?'selected':''}>${u}</option>`).join('')}</select></label></div><label>Область дозы<select name="doseScope"><option value="total">Всего</option><option value="each-nostril" ${r.doseScope==='each-nostril'?'selected':''}>В каждую ноздрю</option></select></label>${field('Часы через запятую','times',Array.isArray(r.times)?r.times.join(', '):r.times||'',(r.type==='prn'||r.type==='interval'?'':'required ')+ 'placeholder="По согласованному расписанию"')}<div class="dose-fields">${field('Начало','startDate',r.startDate||'','type="date" required')}${field('Окончание · если известно','endDate',r.endDate||'','type="date"')}</div><label>Предписание<select name="carePhase">${Object.entries(phases).map(([v,l])=>`<option value="${v}" ${v===(r.carePhase||p.carePhase||'')?'selected':''}>${l}</option>`).join('')}</select></label><details><summary>Формулировка врача</summary><p class="source-text">${e(r.sourceText||'')}</p>${field('Условия','conditions',r.conditions,'maxlength="2000"')}${field('Концентрация','strength',r.strength,'maxlength="150"')}</details><label class="check"><input type="checkbox" name="confirmed" required>Сверено с назначением врача</label>${footer()}`,async data=>{await api('/prescriptions'+(id?'/'+id:''),{method:id?'PUT':'POST',body:{...r,...data,personId:p.id,type:r.type||'daily',timeZone:r.timeZone||tz(),confirmed:data.confirmed==='on',ingredients:Array.isArray(r.ingredients)?r.ingredients.join(' + '):r.ingredients||'',documentId:documentId||r.documentId||'',version:r.version,sourceText:r.sourceText||''}});modal.close();await refresh();$('.doctor').open=true;});
}
root.addEventListener('click',async event=>{
  const tab=event.target.closest('[data-patient]');if(tab&&!busy&&!recording){patientId=tab.dataset.patient;localStorage.setItem('medika-patient',patientId);render();return;}
  const b=event.target.closest('[data-act]');if(!b)return;
  try{const {act,id}=b.dataset;if(act==='voice')await voice();if(act==='text'){textEntry=!textEntry;render();if(textEntry)$('#phrase').focus();}if(act==='tools')tools();if(act==='person')personForm(null);if(act==='template')template();if(act==='void')voidRecord(b.dataset.source,id);if(act==='document')documentView(id);if(act==='upload')upload();if(act==='rx')rxForm(id);if(act==='draft-rx'){const d=state.documents.find(d=>d.id===id);rxForm('',d.suggestions[Number(b.dataset.index)],d.id);}}catch(error){toast(error.message);}
});
window.addEventListener('pagehide',()=>recording?.cancel());
function viewport(){document.documentElement.style.setProperty('--screen-height',(window.visualViewport?.height||window.innerHeight)+'px');}window.visualViewport?.addEventListener('resize',viewport);viewport();
try{await refresh();}catch(error){root.innerHTML=`<main class="start"><h1>Медика</h1><p>${e(error.message)}</p><a href="/">Открыть снова</a></main>`;}
