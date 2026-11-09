import {careDrug,careFamily,escapeHTML as e} from './family-card.js';
import {familyPreview} from './family-preview-model.js';
const root=document.querySelector('#family'),dialog=document.querySelector('#family-info'),statusNode=document.querySelector('#family-status'),timeZone='Europe/Chisinau';
let token='',model,selected='all',loading=false,saving=false;
async function api(path,body=null,retry=false){
  if(!token){const r=await fetch('/api/session');if(!r.ok)throw Error('Не удалось открыть сессию');token=(await r.json()).token;}
  let r;try{r=await fetch('/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch{const error=Error('Нет связи с журналом');error.uncertain=Boolean(body);throw error;}
  if(r.status===403&&!retry){token='';return api(path,body,true);}
  let result;try{result=await r.json();}catch{const error=Error('Не удалось получить ответ журнала');error.uncertain=Boolean(body);throw error;}
  if(!r.ok)throw Error(result.error||'Не удалось обратиться к журналу');return result;
}
const allRows=()=>model?.cards.flatMap(p=>[...(p.current?.rows||[]),...p.later.flatMap(g=>g.rows),...p.earlier.flatMap(g=>g.rows),...p.prn])||[];
const findRow=key=>allRows().find(r=>r.key===key);
function message(text){statusNode.textContent=text;clearTimeout(message.timer);message.timer=setTimeout(()=>statusNode.textContent='',7000);}
const renderRow=(r,later=false)=>careDrug(r.name,r.dose,'',{later,after:r.after,readOnly:!r.canTake||!r.key,taken:r.taken,status:r.status,fields:r.fields,moreId:r.info.fields.length||r.info.notes.length||r.info.source?r.key:'',actionKey:r.canTake?r.key:''});
const rows=(group,later=false)=>group.rows.map(r=>renderRow(r,later)).join('');
const laterGroup=group=>`<section class="care-later"><h3>${e(group.label)}</h3>${rows(group,true)}</section>`;
function card(p){
  const earlier=p.earlier.length?`<details class="care-earlier"><summary>Ранее · ${p.earlier.reduce((n,g)=>n+g.rows.length,0)}</summary>${p.earlier.map(laterGroup).join('')}</details>`:'';
  return `<section class="care-person color-${p.color}" data-person="${e(p.id)}"><header class="care-person-head"><h2>${e(p.name)}</h2>${p.current||p.prn.length?`<span class="care-phase">${e(p.phase)}</span>`:''}</header>${p.current?`<section class="care-current"><h3 class="care-current-slot">${e(p.current.label)}</h3>${rows(p.current)}</section>${p.later.map(laterGroup).join('')}${earlier}`:'<p class="family-empty">Нет действующих плановых назначений</p>'}${p.prn.length?`<section class="care-later"><h3>По необходимости</h3>${p.prn.map(r=>renderRow(r,true)).join('')}</section>`:''}</section>`;
}
function render(focus=false){
  if(!model)return;
  if(!model.cards.some(p=>p.id===selected))selected='all';
  const cards=model.cards.filter(p=>selected==='all'?p.current||p.prn.length:p.id===selected),names=new Map(model.cards.map(p=>[p.id,p.name])),history=model.history.filter(r=>selected==='all'||r.personId===selected).slice(0,8);
  root.innerHTML=`${careFamily(model.cards,selected)}<main class="care-board"><h1 class="sr-only">Назначения семьи</h1><div class="care-people">${cards.length?cards.map(card).join(''):'<p class="family-empty">Действующих назначений нет</p>'}</div><section class="care-history"><h2>Последние события</h2>${history.length?history.map(r=>`<div class="care-event"><time>${e(r.time)}</time><span>${e(names.get(r.personId)||'')}</span><strong>${e(r.name)}${r.detail?`<small>${e(r.detail)}</small>`:''}</strong></div>`).join(''):'<p class="family-empty">Событий пока нет</p>'}</section></main><footer class="family-preview-footer"><a class="voice" href="/">Открыть журнал</a></footer>`;
  root.setAttribute('aria-busy',String(saving));if(saving)root.querySelectorAll('input,button').forEach(input=>input.disabled=true);
  if(focus)[...root.querySelectorAll('[name="care-person"]')].find(input=>input.value===selected)?.focus({preventScroll:true});
}
async function refresh(){const now=new Date(),date=now.toLocaleDateString('sv-SE',{timeZone});const [state,schedule]=await Promise.all([api('/state'),api('/schedule?date='+date)]);model=familyPreview(state,schedule,{date,now,timeZone});render();}
function loadError(text){model=null;root.setAttribute('aria-busy','false');message('');root.innerHTML=`<main class="family-loading" role="alert"><p>${e(text)}</p><button type="button" data-retry>Обновить</button><a href="/">Открыть журнал</a></main>`;}
async function load(){
  if(loading||saving)return;loading=true;if(model){root.setAttribute('aria-busy','true');root.querySelectorAll('input,button').forEach(control=>control.disabled=true);}
  try{await refresh();}
  catch(error){loadError(error.message);}
  finally{loading=false;}
}
async function take(input){
  const row=findRow(input.dataset.take);if(!row)return;
  if(saving||loading||!row.canTake){input.checked=row.taken;return;}
  if(model.date!==new Date().toLocaleDateString('sv-SE',{timeZone})){input.checked=row.taken;await load();message('Расписание обновлено. Выберите приём заново.');return;}
  const checked=input.checked,key=row.key,occurredAt=new Date().toISOString();saving=true;message('');root.setAttribute('aria-busy','true');root.querySelectorAll('input,button').forEach(control=>control.disabled=true);
  let error=null;
  try{if(checked)await api('/events',{rxId:row.rxId,rxVersion:row.rxVersion,key,date:model.date,status:'taken',dose:row.plannedDose,occurredAt});else await api('/events/'+row.eventId+'/void',{version:row.eventVersion,reason:'Отменено на семейной доске'});}
  catch(e){error=e;}
  try{await refresh();message(error?(error.uncertain?'Ответ на запись не получен. Состояние обновлено из журнала.':error.message):checked?'Приём отмечен':'Отметка отменена');}
  catch{loadError('Не удалось обновить журнал. Отметка могла сохраниться — обновите данные перед повтором.');}
  finally{saving=false;if(model){render();[...root.querySelectorAll('[data-take]')].find(node=>node.dataset.take===key)?.focus({preventScroll:true});}}
}
function medicineInfo(key){
  const row=findRow(key);if(!row)return;
  const fields=list=>`<dl class="prescription-fields">${list.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
  dialog.innerHTML=`<header><h2 id="family-info-title">${e(row.name)}</h2><button type="button" data-close-info autofocus>Закрыть</button></header>${row.info.fields.length?`<section><h3>Данные препарата</h3>${fields(row.info.fields)}</section>`:''}${row.info.notes.length?`<section><h3>Условия назначения</h3>${fields(row.info.notes)}</section>`:''}${row.info.source?`<details class="medicine-source"><summary>Исходная запись врача</summary><p>${e(row.info.source)}</p></details>`:''}`;
  dialog.showModal();
}
dialog.addEventListener('click',event=>{if(event.target.closest('[data-close-info]'))dialog.close();});
root.addEventListener('change',event=>{if(event.target.name==='care-person'){if(saving)return;selected=event.target.value;render(true);}else if(event.target.matches('[data-take]'))take(event.target);});
root.addEventListener('click',event=>{if(event.target.closest('[data-retry]'))load();const more=event.target.closest('[data-medicine-info]');if(more&&!saving)medicineInfo(more.dataset.medicineInfo);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')load();});
load();
