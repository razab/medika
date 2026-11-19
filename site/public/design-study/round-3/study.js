import {directions} from './variants.js';
const variant=directions.find(v=>location.pathname.endsWith('/'+v.id))||directions[0];
const people=[{id:'alice',name:'Алиса',initial:'А',phase:'Острая фаза'},{id:'danya',name:'Даня',initial:'Д',phase:'Острая фаза'},{id:'mom',name:'Мама',initial:'М',phase:'Поддерживающая'},{id:'dad',name:'Папа',initial:'П',phase:'Поддерживающая'}];
const medicines=[
 {id:'spray',person:'alice',name:'Спрей для носа',dose:'2',unit:'пшика',form:'Назальный спрей',courseDaysLeft:5,slots:['Завтрак','Обед','Ужин']},
 {id:'drops',person:'alice',name:'Капли',dose:'5',unit:'капель',form:'Капли для приёма внутрь',courseDaysLeft:3,slots:['Завтрак','Ужин']},
 {id:'solution',person:'danya',name:'Первая ингаляция',dose:'1',unit:'мл',form:'Раствор для ингаляции',courseDaysLeft:4,slots:['Завтрак','Ужин']},
 {id:'second',person:'danya',name:'Вторая ингаляция',dose:'1',unit:'мл',form:'Суспензия для ингаляции',courseDaysLeft:4,slots:['Завтрак']},
 {id:'capsule',person:'mom',name:'Капсулы',dose:'1',unit:'капс.',form:'Капсулы',courseDaysLeft:null,slots:['Завтрак','Ужин']},
 {id:'tablet',person:'dad',name:'Таблетки',dose:'1',unit:'табл.',form:'Таблетки',courseDaysLeft:1,slots:['Ужин']}
];
const meals=['Завтрак','Обед','Ужин'];
const numberForms=new Intl.PluralRules('ru');
const plural=(n,one,few,many)=>({one,few,many,other:many}[numberForms.select(n)]);
const rows=meals.flatMap(slot=>medicines.filter(m=>m.slots.includes(slot)).map(m=>({...m,slot,key:m.id+'-'+slot})));
const validKeys=new Set(rows.map(r=>r.key)),storageKey='medika-design3:'+variant.id;
const initial=['spray-Завтрак','solution-Завтрак'];
let taken=new Map(initial.map(key=>[key,Date.now()-3*60_000]));
try{const stored=JSON.parse(sessionStorage.getItem(storageKey));if(Array.isArray(stored))taken=new Map(stored.filter(x=>Array.isArray(x)&&validKeys.has(x[0])&&Number.isFinite(x[1])&&x[1]>0&&x[1]<=Date.now()+60_000));}catch{}
let selected='all',tab='schedule',medicineId='',largeText=false;
const expanded=new Set(),scrolls={schedule:0,medicines:0,history:0};
const app=document.querySelector('#app');
const p=id=>people.find(p=>p.id===id);
const visible=()=>rows.filter(r=>selected==='all'||r.person===selected);
const avatar=id=>`<span class="avatar ${id}" aria-hidden="true">${p(id).initial}</span>`;
const check='<span class="check-icon" aria-hidden="true"></span>';
document.body.classList.add(variant.id);
const query=new URLSearchParams(location.search);
if(query.get('capture')==='1')document.body.classList.add('capture');
if(query.get('text')==='large'){largeText=true;document.documentElement.classList.add('large-text');document.querySelector('#text-size').setAttribute('aria-pressed','true');}
document.title=variant.title+' — Медика';

function save(){try{sessionStorage.setItem(storageKey,JSON.stringify([...taken]));}catch{}}
function progress(r){const count=r.slots.filter(s=>taken.has(r.id+'-'+s)).length;return `<span class="progress" aria-label="${count} из ${r.slots.length} приёмов отмечено"><span class="dots" aria-hidden="true">${r.slots.map(s=>`<i class="${taken.has(r.id+'-'+s)?'filled':''}"></i>`).join('')}</span></span>`;}
// Synthetic display fields; a working prescription must calculate this from its end date.
function course(r){const n=r.courseDaysLeft;return n==null?'Курс не указан':n===1?'Последний день':`Ещё ${n} ${plural(n,'день','дня','дней')}`;}
function timerText(){const first=taken.get('solution-Завтрак');if(!first)return 'Первый приём не отмечен';const elapsed=Date.now()-first;if(elapsed<15*60_000)return 'Ещё '+Math.ceil((15*60_000-elapsed)/60_000)+' мин';if(elapsed<=30*60_000)return 'Интервал 15–30 мин';return 'Интервал истёк';}
function timer(r){return r.id==='second'&&!taken.has(r.key)?`<div class="interval"><span class="clock-icon" aria-hidden="true"></span><div><strong data-timer>${timerText()}</strong><p>После первой ингаляции</p></div></div>`:'';}
function takeButton(r,full=false){const done=taken.has(r.key);return `<button type="button" class="take ${full?'full-take':''}" data-take="${r.key}" aria-pressed="${done}" aria-label="${done?'Отменить отметку':'Отметить приём'}: ${p(r.person).name}, ${r.name}, ${r.slot}">${check}${full?`<span>${done?'Принято · отменить':'Отметить приём'}</span>`:''}</button>`;}
function drug(r,{person=true,full=false}={}){
 const open=expanded.has(r.key),done=taken.has(r.key);
 return `<article class="med ${done?'is-taken':''}" data-row="${r.key}">
  ${person?`<div class="med-person">${avatar(r.person)}<span>${p(r.person).name}</span><small>${p(r.person).phase}</small></div>`:''}
  <div class="med-main"><button class="disclose" type="button" data-expand="${r.key}" aria-expanded="${open}" aria-label="${open?'Скрыть':'Показать'} назначение: ${p(r.person).name}, ${r.name}, ${r.slot}"><span class="med-copy"><span class="med-name">${r.name}</span><span class="med-group">Группа не уточнена</span></span><span class="dose"><strong>${r.dose}</strong> ${r.unit}</span><i class="chevron" aria-hidden="true"></i></button>${!full?takeButton(r):''}</div>
  <div class="med-status">${progress(r)}${done?'<span class="status-label">Принято</span>':''}<span class="course-summary">${course(r)}</span></div>${timer(r)}
  ${open?`<section class="rx-detail" aria-label="Назначение ${r.name}"><h3>Назначение</h3><dl><div><dt>Разовая доза</dt><dd>${r.dose} ${r.unit}</dd></div><div><dt>Когда</dt><dd>${r.slot}</dd></div><div><dt>Кратность</dt><dd>${r.slots.length} ${r.slots.length===1?'раз':'раза'} в день</dd></div><div><dt>Курс</dt><dd>${course(r)}</dd></div></dl><p>Условный пример. Связь с едой не задана.</p><button class="text-button" data-medicine="${r.id}" type="button">О препарате</button></section>`:''}
  ${full?takeButton(r,true):''}
 </article>`;
}
function mealHead(slot){return `<header class="meal-heading"><h2>${slot}</h2><span>${visible().filter(r=>r.slot===slot).length} ${plural(visible().filter(r=>r.slot===slot).length,'приём','приёма','приёмов')}</span></header>`;}
function feed(full=false){return meals.map(slot=>{const list=visible().filter(r=>r.slot===slot);return list.length?`<section class="meal-block">${mealHead(slot)}<div class="med-list">${list.map(r=>drug(r,{full})).join('')}</div></section>`:'';}).join('');}
function family(){return people.filter(x=>selected==='all'||selected===x.id).map(person=>`<section class="person-block ${person.id}"><header class="person-heading">${avatar(person.id)}<div><h2>${person.name}</h2><p>${person.phase}</p></div></header>${meals.map(slot=>{const list=rows.filter(r=>r.person===person.id&&r.slot===slot);return list.length?`<section class="person-meal"><h3>${slot}</h3>${list.map(r=>drug(r,{person:false})).join('')}</section>`:'';}).join('')}</section>`).join('');}
function sequence(){return meals.map(slot=>{
 const list=visible().filter(r=>r.slot===slot);if(!list.length)return '';
 const chain=list.filter(r=>['solution','second'].includes(r.id)),rest=list.filter(r=>!chain.includes(r));
 return `<section class="meal-block">${mealHead(slot)}${chain.length>1?`<section class="sequence-group"><header><span class="chain-icon" aria-hidden="true"></span><h3>Ингаляции Дани</h3></header><p class="sequence-note">Связанные процедуры</p><div class="steps">${chain.map((r,i)=>`<div class="step"><span class="step-number" aria-hidden="true">${i+1}</span>${drug(r,{person:false})}</div>`).join('')}</div></section>`:chain.map(r=>drug(r)).join('')}<div class="med-list">${rest.map(r=>drug(r)).join('')}</div></section>`;
 }).join('');}
function history({side=false}={}){
 const list=[...taken].map(([key,at])=>({...rows.find(r=>r.key===key),at})).filter(r=>selected==='all'||r.person===selected).sort((a,b)=>b.at-a.at);
 return `<section class="journal ${side?'side-journal':''}" aria-label="История приёмов"><header class="journal-heading"><h2>История</h2><span>${list.length} ${plural(list.length,'отметка','отметки','отметок')}</span></header>${list.length?list.map(r=>`<article class="journal-item">${avatar(r.person)}<div><h3>${p(r.person).name}</h3><p>${r.name}</p><span class="journal-dose">${r.dose} ${r.unit}</span><small>Принято · ${r.slot.toLowerCase()}</small></div><span class="journal-check" aria-label="Принято">${check}</span></article>`).join(''):'<p class="empty">Пока нет отметок. Они появятся после записи приёма.</p>'}<p class="demo-caption">История этого примера хранится только в вашей вкладке.</p></section>`;
}
function catalogue(){return `<section class="catalogue" aria-label="Лекарства"><p class="section-note">О препарате — отдельно от назначения человеку.</p>${medicines.map(m=>`<button type="button" class="catalogue-item" data-medicine="${m.id}"><span class="medicine-icon" aria-hidden="true"></span><span><strong>${m.name}</strong><small>${m.form}</small></span><i class="chevron" aria-hidden="true"></i></button>`).join('')}</section>`;}
function medicine(){const m=medicines.find(m=>m.id===medicineId);return `<section class="medicine-view"><button class="back-button" data-drug-back type="button"><i class="chevron" aria-hidden="true"></i>К лекарствам</button><h2>${m.name}</h2><p class="section-note">${m.form}</p><dl><div><dt>Группа</dt><dd>Не уточнена</dd></div><div><dt>Концентрация</dt><dd>Не задана</dd></div><div><dt>Источник</dt><dd>Синтетический пример</dd></div></dl><h3>Способ применения</h3><p>В рабочем приложении здесь отображается проверенная инструкция именно этого препарата. Личная доза и расписание находятся в назначении человека.</p></section>`;}
function navigation(cls){return `<nav class="primary-nav ${cls}" aria-label="Разделы">${[['schedule','Приёмы','schedule-icon'],['medicines','Лекарства','medicine-icon'],['history','История','history-icon']].map(([id,label,icon])=>`<button type="button" data-tab="${id}" class="${tab===id?'selected':''}" aria-current="${tab===id?'page':'false'}"><span class="${icon}" aria-hidden="true"></span><span>${label}</span></button>`).join('')}</nav>`;}
function filters(){return `<nav class="family-filter" aria-label="Член семьи"><button type="button" data-person="all" aria-pressed="${selected==='all'}" class="${selected==='all'?'selected':''}">${variant.id==='family'?'<span class="all-avatar" aria-hidden="true">Все</span>Семья':'Все'}</button>${people.map(person=>`<button type="button" data-person="${person.id}" aria-pressed="${selected===person.id}" class="${selected===person.id?'selected':''}">${variant.id==='family'?avatar(person.id):''}<span>${person.name}</span></button>`).join('')}</nav>`;}
function render(){
 const schedule=tab==='schedule';
 app.innerHTML=`<div class="app-frame"><header class="app-header"><a href="/design-study/round-3" class="brand" aria-label="Медика — варианты дизайна"><span class="brand-mark" aria-hidden="true"></span>медика</a>${navigation('desktop-nav')}<span class="variant-title">${variant.title}</span></header><div class="title-row"><h1 tabindex="-1">${tab==='medicines'&&medicineId?'Препарат':schedule?'Приёмы':tab==='history'?'История':'Лекарства'}</h1>${schedule?'<span class="plan-state">Все приёмы</span>':''}</div>${tab!=='medicines'?filters():''}<div class="workspace ${schedule?'with-history':''}"><main class="main-content" aria-label="${schedule?'Расписание':'Основное содержимое'}">${schedule?`<div class="schedule-content">${variant.id==='family'?family():variant.id==='sequence'?sequence():feed(variant.id==='large')}</div>`:tab==='history'?history():medicineId?medicine():catalogue()}</main>${schedule?`<aside class="history-panel">${history({side:true})}</aside>`:''}</div>${navigation('mobile-nav')}</div>`;
}
function focus(selector){app.querySelector(selector)?.focus({preventScroll:true});}
app.addEventListener('click',e=>{
 const take=e.target.closest('[data-take]');
 if(take){const key=take.dataset.take,was=taken.has(key);if(was)taken.delete(key);else taken.set(key,Date.now());save();render();focus(`[data-take="${key}"]`);const r=rows.find(r=>r.key===key);document.querySelector('#announce').textContent=`${p(r.person).name}, ${r.name}: ${was?'отметка отменена':'приём отмечен'}`;return;}
 const expand=e.target.closest('[data-expand]');
 if(expand){const key=expand.dataset.expand;expanded.has(key)?expanded.delete(key):expanded.add(key);render();focus(`[data-expand="${key}"]`);return;}
 const filter=e.target.closest('[data-person]');
 if(filter){selected=filter.dataset.person;render();focus(`[data-person="${selected}"]`);return;}
 const nav=e.target.closest('[data-tab]');
 if(nav){scrolls[tab]=scrollY;const target=nav.dataset.tab;if(target==='medicines'&&tab==='medicines')medicineId='';tab=target;render();scrollTo(0,scrolls[tab]);focus('h1');return;}
 const info=e.target.closest('[data-medicine]');
 if(info){scrolls[tab]=scrollY;tab='medicines';medicineId=info.dataset.medicine;render();scrollTo(0,0);return;}
 if(e.target.closest('[data-drug-back]')){medicineId='';render();scrollTo(0,scrolls.medicines);}
});
document.querySelector('#reset').addEventListener('click',()=>{taken=new Map(initial.map(key=>[key,Date.now()-3*60_000]));selected='all';tab='schedule';medicineId='';expanded.clear();save();render();scrollTo(0,0);document.querySelector('#announce').textContent='Пример сброшен';});
document.querySelector('#text-size').addEventListener('click',e=>{largeText=!largeText;document.documentElement.classList.toggle('large-text',largeText);e.currentTarget.setAttribute('aria-pressed',String(largeText));});
setInterval(()=>document.querySelectorAll('[data-timer]').forEach(el=>el.textContent=timerText()),1000);
render();
