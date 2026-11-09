import {careDrug,careFamily,escapeHTML as e} from './family-card.js';
import {familyPreview} from './family-preview-model.js';
const root=document.querySelector('#family'),timeZone='Europe/Chisinau';
let token='',model,selected='all',loading=false;
async function get(path,retry=false){
  if(!token){const r=await fetch('/api/session');if(!r.ok)throw Error('Не удалось открыть сессию');token=(await r.json()).token;}
  const r=await fetch('/api'+path,{headers:{'X-Medika-Token':token}});
  if(r.status===403&&!retry){token='';return get(path,true);}
  if(!r.ok)throw Error('Не удалось прочитать сохранённые данные');return r.json();
}
const rows=(group,later=false)=>group.rows.map(r=>careDrug(r.name,r.dose,r.instruction,{later,after:r.after,readOnly:true,taken:r.taken,status:r.status})).join('');
const laterGroup=group=>`<section class="care-later"><h3>${e(group.label)}</h3>${rows(group,true)}</section>`;
function card(p){
  const earlier=p.earlier.length?`<details class="care-earlier"><summary>Ранее · ${p.earlier.reduce((n,g)=>n+g.rows.length,0)}</summary>${p.earlier.map(laterGroup).join('')}</details>`:'';
  return `<section class="care-person color-${p.color}" data-person="${e(p.id)}"><header class="care-person-head"><h2>${e(p.name)}</h2>${p.current||p.prn.length?`<span class="care-phase">${e(p.phase)}</span>`:''}</header>${p.current?`<section class="care-current"><h3 class="care-current-slot">${e(p.current.label)}</h3>${rows(p.current)}</section>${p.later.map(laterGroup).join('')}${earlier}`:'<p class="family-empty">Нет действующих плановых назначений</p>'}${p.prn.length?`<section class="care-later"><h3>По необходимости</h3>${p.prn.map(r=>careDrug(r.name,r.dose,r.instruction,{later:true,readOnly:true})).join('')}</section>`:''}</section>`;
}
function render(focus=false){
  if(!model)return;
  if(!model.cards.some(p=>p.id===selected))selected='all';
  const cards=model.cards.filter(p=>selected==='all'?p.current||p.prn.length:p.id===selected),names=new Map(model.cards.map(p=>[p.id,p.name])),history=model.history.filter(r=>selected==='all'||r.personId===selected).slice(0,8);
  root.innerHTML=`${careFamily(model.cards,selected)}<main class="care-board"><h1 class="sr-only">Назначения семьи</h1><div class="care-people">${cards.length?cards.map(card).join(''):'<p class="family-empty">Действующих назначений нет</p>'}</div><section class="care-history"><h2>Последние события</h2>${history.length?history.map(r=>`<div class="care-event"><time>${e(r.time)}</time><span>${e(names.get(r.personId)||'')}</span><strong>${e(r.name)}${r.detail?`<small>${e(r.detail)}</small>`:''}</strong></div>`).join(''):'<p class="family-empty">Событий пока нет</p>'}</section></main><footer class="family-preview-footer"><p>Просмотр сохранённых данных. Отметки — из журнала.</p><a class="voice" href="/">Открыть журнал</a></footer>`;
  if(focus)[...root.querySelectorAll('[name="care-person"]')].find(input=>input.value===selected)?.focus({preventScroll:true});
}
async function load(){
  if(loading)return;loading=true;
  try{const now=new Date(),date=now.toLocaleDateString('sv-SE',{timeZone});const [state,schedule]=await Promise.all([get('/state'),get('/schedule?date='+date)]);model=familyPreview(state,schedule,{date,now,timeZone});render();}
  catch(error){root.innerHTML=`<main class="family-loading" role="alert"><p>${e(error.message)}</p><button type="button" data-retry>Повторить</button><a href="/">Открыть журнал</a></main>`;}
  finally{loading=false;}
}
root.addEventListener('change',event=>{if(event.target.name==='care-person'){selected=event.target.value;render(true);}});
root.addEventListener('click',event=>{if(event.target.closest('[data-retry]'))load();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')load();});
load();
