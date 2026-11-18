import {directions} from './variants.js';

const variant = directions.find(v=>location.pathname.endsWith('/'+v.id)) || directions[0];
const people = [
  {id:'alice',name:'Алиса',initial:'А',phase:'Острая фаза'},
  {id:'danya',name:'Даня',initial:'Д',phase:'Острая фаза'},
  {id:'mom',name:'Мама',initial:'М',phase:'Поддерживающая'},
  {id:'dad',name:'Папа',initial:'П',phase:'Поддерживающая'}
];
const medicines = [
  {id:'spray',person:'alice',name:'Спрей для носа',dose:'2',unit:'пшика',kind:'spray',group:'Группа не уточнена',slots:['Завтрак','Обед','Ужин'],note:'В этом примере показаны форма препарата и разовая доза. Инструкция открывается отдельно от отметки.'},
  {id:'solution',person:'danya',name:'Раствор для ингаляции',dose:'1',unit:'мл',kind:'bottle',group:'Группа не уточнена',slots:['Завтрак','Ужин'],note:'Состав смеси и длительность процедуры берутся из назначения. В демонстрации они не заданы.'},
  {id:'second',person:'danya',name:'Вторая ингаляция',dose:'1',unit:'мл',kind:'bottle',group:'Группа не уточнена',slots:['Завтрак'],note:'Связанный приём в этом примере напоминает об интервале после предыдущего. Отметка факта остаётся доступна.'},
  {id:'capsule',person:'mom',name:'Капсулы',dose:'1',unit:'капс.',kind:'capsule',group:'Группа не уточнена',slots:['Завтрак','Ужин'],note:'Концентрация упаковки и личная разовая доза — отдельные сведения.'},
  {id:'tablet',person:'dad',name:'Таблетки',dose:'1',unit:'табл.',kind:'tablet',group:'Группа не уточнена',slots:['Ужин'],note:'Здесь будет источник назначения, курс и способ применения выбранного препарата.'}
];
const slots=['Завтрак','Обед','Ужин'];
let selected='all',historyOpen=false;
const initial=['spray-Завтрак','solution-Завтрак'];
const taken=new Set(initial),expanded=new Set();
const log=[];
const app=document.querySelector('#app');
document.body.className=variant.id;
if(new URLSearchParams(location.search).get('capture')==='1')document.body.classList.add('capture');
document.querySelector('#variant-name').textContent=variant.title;
document.title=variant.title+' — Медика';

const person=id=>people.find(p=>p.id===id);
const key=(m,slot)=>m.id+'-'+slot;
const matches=m=>selected==='all'||m.person===selected;
const markIcon='<span class="check-icon" aria-hidden="true"></span>';
const avatar=p=>`<span class="avatar ${p.id}" aria-hidden="true">${p.initial}</span>`;
const drugIcon=m=>`<span class="drug-shape ${m.kind}" aria-hidden="true"><i></i></span>`;
function progress(m){
  const done=m.slots.filter(s=>taken.has(key(m,s))).length;
  return `<div class="progress" aria-label="${done} из ${m.slots.length} приёмов отмечено"><span class="dots" aria-hidden="true">${m.slots.map(s=>`<i class="${taken.has(key(m,s))?'filled':''}"></i>`).join('')}</span><span>${done} из ${m.slots.length}</span></div>`;
}
function drug(m,slot,{withPerson=false,large=false}={}){
  const id=key(m,slot),done=taken.has(id),open=expanded.has(id),p=person(m.person);
  return `<article class="drug ${done?'is-taken':''} ${large?'large-drug':''}" data-occurrence="${id}">
    ${withPerson?`<div class="drug-person">${avatar(p)}<span>${p.name}</span><small>${p.phase}</small></div>`:''}
    <div class="drug-main">${drugIcon(m)}<div class="drug-title"><h3>${m.name}</h3><p class="group">${m.group}</p></div><p class="dose"><strong>${m.dose}</strong> ${m.unit}</p>${!large?`<button class="take" type="button" data-take="${id}" aria-label="${done?'Отменить отметку':'Отметить приём'}: ${p.name}, ${m.name}, ${slot}" aria-pressed="${done}">${markIcon}</button>`:''}</div>
    <div class="drug-meta">${progress(m)}<span class="take-status">${done?'Принято':''}</span><button class="more" type="button" data-more="${id}" aria-label="${open?'Скрыть':'Показать'} назначение: ${m.name}, ${slot}" aria-expanded="${open}"><span>Подробнее</span><i aria-hidden="true"></i></button></div>
    ${m.id==='second'&&!done?'<p class="interval"><span class="timer-icon" aria-hidden="true"></span>После первой ингаляции <b>Ещё 12 минут</b></p>':''}
    ${open?`<div class="drug-detail"><p>${m.note}</p><dl><div><dt>Приём</dt><dd>${slot}</dd></div><div><dt>Разовая доза</dt><dd>${m.dose} ${m.unit}</dd></div></dl><p class="synthetic-source">Условный пример, без назначения врача.</p></div>`:''}
    ${large?`<button class="take full-take" type="button" data-take="${id}" aria-pressed="${done}">${markIcon}<span>${done?'Принято · отменить отметку':'Отметить приём'}</span></button>`:''}
  </article>`;
}
function filters(){return `<nav class="people-filter" aria-label="Кого показать"><button data-person="all" class="${selected==='all'?'active':''}" aria-pressed="${selected==='all'}">${variant.id==='people'?'<span class="family-circle" aria-hidden="true">Все</span>Семья':'Все'}</button>${people.map(p=>`<button data-person="${p.id}" class="${selected===p.id?'active':''}" aria-pressed="${selected===p.id}">${variant.id==='people'?avatar(p):''}${p.name}</button>`).join('')}</nav>`;}
function header(){return `<header class="app-header"><a class="wordmark" href="/design-study/round-2" aria-label="Медика — все варианты дизайна"><span class="brand-symbol" aria-hidden="true"></span>медика</a><button class="history-toggle" data-history aria-expanded="${historyOpen}"><span class="history-icon" aria-hidden="true"></span>История</button></header><div class="page-heading"><h1>${variant.id==='people'?'Вся семья':variant.id==='agenda'?'Ваш распорядок':variant.id==='focus'?'Забота шаг за шагом':variant.id==='board'?'Семейный распорядок':'Забота о близких'}</h1><p>${variant.id==='focus'?'Каждый приём — одним касанием':variant.id==='board'?'Все приёмы перед вами':'Лекарства и приёмы вашей семьи'}</p></div>${filters()}`;}
function history(){
  const entries=[...log].reverse().filter(e=>selected==='all'||e.person===selected);
  return `<aside class="history ${historyOpen?'is-open':''}" id="history"><h2>История</h2>${historyOpen?'<button class="history-back" data-back>К расписанию</button>':''}<p class="history-lead">Последние отметки</p><div class="history-items">${entries.map(e=>`<div class="history-item">${avatar(person(e.person))}<div><b>${person(e.person).name}</b><p>${e.name}</p><small>${e.action} · ${e.slot.toLowerCase()}</small></div></div>`).join('')}${medicines.filter(matches).flatMap(m=>m.slots.filter(s=>initial.includes(key(m,s))).map(s=>`<div class="history-item">${avatar(person(m.person))}<div><b>${person(m.person).name}</b><p>${m.name}</p><small>Принято · ${s.toLowerCase()}</small></div></div>`)).join('')}</div><p class="history-foot">Отметки из этого примера не попадут в ваш журнал.</p></aside>`;
}
function personal(){return people.filter(p=>selected==='all'||p.id===selected).map(p=>`<section class="person-section ${p.id}"><header class="person-header">${avatar(p)}<div><h2>${p.name}</h2><p>${p.phase}</p></div></header>${slots.map(slot=>{const meds=medicines.filter(m=>m.person===p.id&&m.slots.includes(slot));return meds.length?`<section class="meal"><h3 class="slot-name">${slot}</h3>${meds.map(m=>drug(m,slot)).join('')}</section>`:'';}).join('')}</section>`).join('');}
function byMeal(large=false){return slots.map((slot,index)=>{const meds=medicines.filter(m=>matches(m)&&m.slots.includes(slot));return meds.length?`<section class="meal-section"><header class="meal-header"><span class="meal-symbol meal-${index}" aria-hidden="true"></span><div><h2>${slot}</h2><p>${meds.length} ${meds.length===1?'приём':'приёма'}</p></div></header><div class="meal-drugs">${meds.map(m=>drug(m,slot,{withPerson:true,large})).join('')}</div></section>`:'';}).join('');}
function render(){
  app.innerHTML=`<div class="app-shell">${header()}<div class="workspace"><main class="schedule" aria-label="Расписание">${['calm','people'].includes(variant.id)?personal():byMeal(variant.id==='focus')}</main>${history()}</div><footer class="app-footer"><span class="footer-dot" aria-hidden="true"></span>Все приёмы доступны в расписании</footer></div>`;
}
app.addEventListener('click',event=>{
  const take=event.target.closest('[data-take]');
  if(take){
    const id=take.dataset.take,m=medicines.find(m=>id.startsWith(m.id+'-')),slot=id.slice(m.id.length+1),was=taken.has(id);
    if(was)taken.delete(id);else taken.add(id);
    log.push({person:m.person,name:m.name,slot,action:was?'Отметка отменена':'Принято'});
    render();
    app.querySelector(`[data-take="${id}"]`)?.focus({preventScroll:true});
    document.querySelector('#announcement').textContent=`${person(m.person).name}, ${m.name}: ${was?'отметка отменена':'приём отмечен'}`;
    return;
  }
  const more=event.target.closest('[data-more]');
  if(more){const id=more.dataset.more;expanded.has(id)?expanded.delete(id):expanded.add(id);render();app.querySelector(`[data-more="${id}"]`)?.focus({preventScroll:true});return;}
  const filter=event.target.closest('[data-person]');
  if(filter){selected=filter.dataset.person;render();app.querySelector(`[data-person="${selected}"]`)?.focus({preventScroll:true});return;}
  if(event.target.closest('[data-history]')){historyOpen=true;render();document.querySelector('#history').scrollIntoView({block:'start'});}
  if(event.target.closest('[data-back]')){historyOpen=false;render();document.querySelector('#app').scrollIntoView({block:'start'});app.querySelector('[data-history]').focus({preventScroll:true});}
});
document.querySelector('#reset').addEventListener('click',()=>{taken.clear();initial.forEach(x=>taken.add(x));expanded.clear();log.length=0;render();document.querySelector('#announcement').textContent='Демонстрационные отметки сброшены';});
render();
