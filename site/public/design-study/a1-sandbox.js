import {careDrug,careFamily,escapeHTML as e} from '/family-card.js';
const root=document.querySelector('#design-demo'),dialog=document.querySelector('#sandbox-info'),notice=document.querySelector('#sandbox-status');
let snapshot,selected='all',changes={},storageKey='',openKey='';
const baseRows=()=>snapshot.model.cards.flatMap(p=>[...(p.current?.rows||[]),...p.later.flatMap(g=>g.rows),...p.earlier.flatMap(g=>g.rows),...p.prn].map(row=>({...row,personId:p.id})));
function message(text){notice.textContent=text;clearTimeout(message.timer);message.timer=setTimeout(()=>notice.textContent='',4000);}
function save(){try{sessionStorage.setItem(storageKey,JSON.stringify({selected,changes}));}catch{message('Изменения останутся до обновления страницы');}}
const fields=list=>`<dl class="prescription-fields">${list.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>`;
function medicineInfo(key){const row=baseRows().find(r=>r.key===key);if(!row)return;dialog.innerHTML=`<header><h2 id="sandbox-info-title">${e(row.name)}</h2><button type="button" data-close>Закрыть</button></header>${row.info.fields.length?`<section><h3>Данные препарата</h3>${fields(row.info.fields)}</section>`:''}${row.info.notes.length?`<section><h3>Условия назначения</h3>${fields(row.info.notes)}</section>`:''}${row.info.source?`<details class="medicine-source"><summary>Исходная запись врача</summary><p>${e(row.info.source)}</p></details>`:''}`;dialog.showModal();}
function renderRow(row,later=false){const edit=changes[row.key],taken=edit?edit.taken:row.taken,status=edit?(taken?'Демо · принято':'Демо · отметка снята'):row.status;return `<div class="sandbox-dose" data-demo-row="${e(row.key)}">${careDrug(row.name,row.dose,'',{later,fields:row.fields,moreId:row.info.fields.length||row.info.notes.length||row.info.source?row.key:'',after:row.after,taken,status})}</div>`;}
const group=g=>`<section class="care-later"><h3>${e(g.label)}</h3>${g.rows.map(r=>renderRow(r,true)).join('')}</section>`;
function card(p){
  const earlier=p.earlier.length?`<details class="care-earlier"><summary>Ранее · ${p.earlier.reduce((n,g)=>n+g.rows.length,0)}</summary>${p.earlier.map(group).join('')}</details>`:'';
  const plan=p.current?`<section class="care-current"><h3 class="sandbox-current-label">${e(p.current.label)}</h3>${p.current.rows.map(r=>renderRow(r)).join('')}</section>${p.later.map(group).join('')}${earlier}`:'<p class="family-empty">Нет действующих плановых назначений</p>';
  return `<section class="care-person color-${p.color}"><header class="care-person-head"><h2>${e(p.name)}</h2>${p.current||p.prn.length?`<span class="care-phase">${e(p.phase)}</span>`:''}</header>${plan}${p.prn.length?`<section class="care-later"><h3>По необходимости</h3>${p.prn.map(r=>renderRow(r,true)).join('')}</section>`:''}</section>`;
}
function render(focus=false){
  const people=snapshot.model.cards,visible=people.filter(p=>selected==='all'?p.current||p.prn.length:p.id===selected),names=new Map(people.map(p=>[p.id,p.name])),rows=new Map(baseRows().map(r=>[r.key,r]));
  const demo=Object.entries(changes).filter(([key])=>rows.has(key)).sort((a,b)=>b[1].at.localeCompare(a[1].at)).map(([key,edit])=>{const row=rows.get(key);return {personId:row.personId,time:new Date(edit.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),name:edit.taken?row.name:'Отмена · '+row.name,detail:edit.taken?row.dose:'Отметка снята',isDemo:true};});
  const history=[...demo,...snapshot.model.history].filter(r=>selected==='all'||r.personId===selected);
  root.innerHTML=`${careFamily(people,selected)}<main class="care-board sandbox-workspace"><section class="sandbox-plan" aria-label="Лекарства и назначения"><h1 class="sr-only">Лекарства и назначения</h1><div class="care-people">${visible.length?visible.map(card).join(''):'<p class="family-empty">Действующих назначений нет</p>'}</div></section><aside class="sandbox-history care-history" aria-label="История"><h2>История</h2>${history.length?history.map(r=>`<div class="care-event${r.isDemo?' demo-event':''}"><time>${e(r.time)}</time><span>${e(names.get(r.personId)||'')}</span><strong>${e(r.name)}<small>${e(r.detail)}${r.isDemo?' · демо':''}</small></strong></div>`).join(''):'<p class="family-empty">Событий нет</p>'}</aside></main><footer class="sandbox-footer"><button type="button" class="voice" data-voice>Событие голосом</button></footer>`;
  if(openKey){const wrapper=[...root.querySelectorAll('[data-demo-row]')].find(n=>n.dataset.demoRow===openKey);if(wrapper)wrapper.querySelector('details').open=true;}
  if(focus)[...root.querySelectorAll('[name="care-person"]')].find(n=>n.value===selected)?.focus({preventScroll:true});
}
async function load(){
  try{
    const session=await fetch('/api/session');if(!session.ok)throw Error();const {token}=await session.json(),response=await fetch('/api/design-study/a1-snapshot',{headers:{'X-Medika-Token':token}});if(!response.ok)throw Error();snapshot=await response.json();if(snapshot.version!==1||!Array.isArray(snapshot.model?.cards))throw Error();
    storageKey='medika-design-a1-sandbox:'+snapshot.revision;const known=new Set(baseRows().map(r=>r.key));
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'{}');selected=snapshot.model.cards.some(p=>p.id===saved.selected)?saved.selected:'all';changes=Object.fromEntries(Object.entries(saved.changes||{}).filter(([key,value])=>known.has(key)&&typeof value?.taken==='boolean'&&Number.isFinite(Date.parse(value.at))));}catch{changes={};}
    document.querySelector('#snapshot-day').textContent=new Date(snapshot.model.date+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
    if(innerWidth>=700)openKey=snapshot.model.cards.find(p=>p.current)?.current.rows[0]?.key||'';
    render();
  }catch{root.innerHTML='<main class="family-loading" role="alert">Не удалось открыть сохранённую копию данных. Обновите страницу.</main>';}
}
root.addEventListener('change',event=>{
  if(event.target.name==='care-person'){selected=event.target.value;save();render(true);return;}
  if(event.target.matches('input[type="checkbox"]')){const key=event.target.closest('[data-demo-row]')?.dataset.demoRow;if(!baseRows().some(r=>r.key===key))return;changes[key]={taken:event.target.checked,at:new Date().toISOString()};save();render();[...root.querySelectorAll('[data-demo-row]')].find(n=>n.dataset.demoRow===key)?.querySelector('input[type="checkbox"]')?.focus({preventScroll:true});message('Отметка только в демо');}
});
root.addEventListener('toggle',event=>{if(event.target.parentElement?.classList.contains('care-med')){const key=event.target.closest('[data-demo-row]')?.dataset.demoRow;if(event.target.open){openKey=key;root.querySelectorAll('.care-med>details[open]').forEach(n=>{if(n!==event.target)n.open=false;});}else if(openKey===key)openKey='';}},true);
root.addEventListener('click',event=>{const more=event.target.closest('[data-medicine-info]');if(more)medicineInfo(more.dataset.medicineInfo);if(event.target.closest('[data-voice]'))message('Голос здесь — элемент макета');});
dialog.addEventListener('click',event=>{if(event.target.closest('[data-close]'))dialog.close();});
document.querySelector('#reset-demo').addEventListener('click',()=>{changes={};selected='all';if(storageKey)sessionStorage.removeItem(storageKey);render();message('Демо сброшено');});
load();
