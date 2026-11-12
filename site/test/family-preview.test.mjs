import test from 'node:test';
import assert from 'node:assert/strict';
import {familyPreview,shortDose} from '../public/family-preview-model.js';
import {careDrug,careFamily} from '../public/family-card.js';
const date='2026-11-09',now=new Date('2026-11-09T18:00:00Z');
test('A1: только подтверждённый текущий курс своего человека; слоты и интервалы сохраняются без домысливания',()=>{
  const people=[{id:'a',name:'Тест А',carePhase:'acute'},{id:'b',name:'Тест Б',carePhase:'prevention'}];
  const base={id:'rx',version:3,personId:'a',name:'ТестСпрей',dose:'2',unit:'впрыскивание',doseScope:'each-nostril',form:'spray',strength:'100 мг/мл',conditions:'Отдельное условие',confirmed:true,startDate:'2026-11-01',endDate:'2026-11-20',carePhase:'acute',sourceText:'Через 10–15 минут после применения ТестПервый использовать ТестСпрей.'};
  const prescriptions=[base,{...base,id:'future',startDate:'2026-11-10'},{...base,id:'unconfirmed',confirmed:false},{...base,id:'other-phase',carePhase:'prevention'},{...base,id:'archived',archived:true},{...base,id:'other-person',personId:'b'}];
  const row={rxId:'rx',personId:'a',name:base.name,dose:base.dose,unit:base.unit,doseScope:base.doseScope};
  const items=[{...row,anchor:'breakfast',label:'Завтрак',displayTime:'07:30'},{...row,anchor:'dinner',label:'Ужин',displayTime:'19:00'},{...row,anchor:'clock',displayTime:'23:00'},...prescriptions.slice(1).map(r=>({...row,rxId:r.id,anchor:'dinner'})),{...row,historical:true,anchor:'dinner'}].map((item,index)=>({...item,key:'synthetic-slot-'+index}));
  const model=familyPreview({people,prescriptions},{items,prn:[]},{date,now});
  assert.equal(model.cards[0].phase,'Острая фаза');assert.equal(model.cards[0].current.label,'Ужин');assert.equal(model.cards[0].current.rows.length,1);assert.equal(model.cards[0].earlier[0].label,'Завтрак');assert.equal(model.cards[0].later[0].label,'23:00');
  const current=model.cards[0].current.rows[0];assert.equal(current.dose,'2 пшика');assert.equal(Object.fromEntries(current.fields)['Доза'],'2 пшика в каждую ноздрю');assert.equal(current.after,'Через 10–15 мин после ТестПервый');assert.equal(Object.fromEntries(model.cards[0].later[0].rows[0].fields)['Время'],'23:00');assert.equal(current.rxVersion,3);assert.equal(current.canTake,true);
  assert.doesNotMatch(JSON.stringify(current.fields),/100 мг|Отдельное условие|использовать/);assert.equal(Object.fromEntries(current.info.fields)['Форма'],'Спрей');assert.equal(Object.fromEntries(current.info.fields)['Концентрация'],'100 мг/мл');assert.equal(Object.fromEntries(current.info.notes)['Условия'],'Отдельное условие');assert.equal(current.info.source,base.sourceText);
  assert.equal(model.cards[1].current,null);assert.equal(model.cards[1].phase,'Поддерживающая');
  const early=familyPreview({people,prescriptions},{items,prn:[]},{date,now:new Date('2026-11-09T03:00:00Z')});assert.equal(early.cards[0].current.label,'Завтрак');
  const late=familyPreview({people,prescriptions},{items,prn:[]},{date,now:new Date('2026-11-09T21:30:00Z')});assert.equal(late.cards[0].current.label,'23:00');
  const family=[{id:'dad',name:'Папа'},{id:'mom',name:'Мама'},{id:'child',name:'Алиса'}],sorted=familyPreview({people:family,prescriptions:[]},{items:[],prn:[]},{date,now});assert.deepEqual(sorted.cards.map(p=>p.id),['child','mom','dad']);assert.deepEqual(family.map(p=>p.id),['dad','mom','child']);
});
test('A1: факт сохраняет свою дозу, отменённые/будущие/вчерашние события не становятся текущими',()=>{
  const rx={id:'rx',personId:'a',name:'ТестИзменён',dose:'9',unit:'мл',confirmed:true,startDate:'2026-11-01'};
  const fact={id:'fact',personId:'a',name:'ТестИсходный',actualDose:'2.5',unit:'мл',status:'taken',occurredAt:'2026-11-09T16:00:00Z',timeZone:'Europe/Chisinau'};
  const model=familyPreview({people:[{id:'a',name:'Тест'}],prescriptions:[rx],events:[fact],activities:[{personId:'a',kind:'temperature',celsius:37.7,status:'recorded',occurredAt:'2026-11-09T17:00:00Z'},{kind:'temperature',celsius:38,occurredAt:'2026-11-09T19:00:00Z'},{...fact,id:'void',status:'void'},{...fact,id:'yesterday',occurredAt:'2026-11-08T12:00:00Z'}]},{items:[{...rx,rxId:rx.id,anchor:'unassigned',event:fact}],prn:[]},{date,now});
  assert.equal(model.cards[0].current.label,'Нужно привязать приём');assert.equal(model.cards[0].current.rows[0].name,'ТестИсходный');assert.equal(model.cards[0].current.rows[0].dose,'2,5 мл');assert.equal(model.history.length,2);assert.equal(model.history[0].name,'37,7 °C');assert.equal(model.history[1].detail,'2,5 мл принято');
});
test('A1: короткие дозы, экранирование и блокировка неподходящего приёма',()=>{
  for(const [dose,text]of [[1,'1 пшик'],[2,'2 пшика'],[5,'5 пшиков'],[11,'11 пшиков'],[21,'21 пшик'],[22,'22 пшика']])assert.equal(shortDose({dose,unit:'впрыскивание'}),text);
  const html=careDrug('<script>bad</script>','2 мл','<img src=x onerror=bad>',{readOnly:true,taken:true});assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/disabled checked/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(careFamily([{id:'a" onfocus="bad',name:'<img>'}]),/<img|value="a" onfocus/);
  const inhalation=familyPreview({people:[],prescriptions:[],activities:[{kind:'inhalation',name:'ТестРаствор',amount:'2',unit:'мл',occurredAt:'2026-11-09T16:00:00Z'}]},{items:[],prn:[]},{date,now}).history[0];assert.equal(inhalation.name,'Ингаляция · ТестРаствор');
});
test('Семейный обзор: середина дня не держит завтрак, выполненный слот не возвращает старые пропуски',async()=>{
  const {selectFamilyGroup}=await import('../public/family-preview-model.js'),at=time=>new Date('2026-11-10T'+time+'Z');
  const groups=[{time:'07:30',rows:[{name:'Первый'}]},{time:'19:00',rows:[{name:'Первый'}]},{time:'23:00',rows:[{name:'Первый'}]}];
  assert.equal(selectFamilyGroup(groups,{now:at('11:38:00')}),1);assert.equal(selectFamilyGroup(groups,{now:at('05:35:00')}),0);assert.equal(selectFamilyGroup(groups,{now:at('21:10:00')}),2);
  const done=structuredClone(groups);done[1].rows[0].taken=true;assert.equal(selectFamilyGroup(done,{now:at('11:38:00')}),1);
  const child=[{time:'07:30',rows:[{}]},{time:'13:30',rows:[{}]},{time:'21:30',rows:[{}]}];assert.equal(selectFamilyGroup(child,{now:at('11:38:00')}),1);
  const chain=structuredClone(groups);chain[1].rows=[{name:'Первый',taken:true,takenAt:'2026-11-10T20:00:00Z'},{name:'Второй',after:'Через 10–15 мин после Первый'}];
  assert.equal(selectFamilyGroup(chain,{now:at('20:05:00')}),1);assert.equal(selectFamilyGroup(chain,{now:at('20:20:00')}),2);
  chain[1].rows[0].takenAt=null;assert.equal(selectFamilyGroup(chain,{now:at('20:05:00')}),2);
});
test('Семейный обзор: у старой температуры есть дата, у неизвестного времени нет выдуманных часов',async()=>{
  const {measurementStamp}=await import('../public/family-preview-model.js'),date='2026-11-10';
  assert.equal(measurementStamp({date,occurredAt:'2026-11-10T11:00:00Z'},date),'13:00');
  assert.equal(measurementStamp({date:'2026-11-09',occurredAt:'2026-11-09T13:24:00Z'},date),'вчера · 15:24');
  assert.equal(measurementStamp({date:'2026-11-08',occurredAt:'2026-11-08T13:24:00Z'},date),'8 ноября · 15:24');
  assert.equal(measurementStamp({date,timeUnknown:true,occurredAt:null},date),'время неизвестно');
  assert.match(measurementStamp({date:'2025-11-08',occurredAt:'2025-11-08T13:24:00Z'},date),/2025/);
});

test('Ручной препарат: явная форма видна в карточке без текстового поля form',()=>{
 const rx={id:'manual',personId:'a',name:'ТестРаствор',medicineForm:'liquid',form:'',dose:'1',unit:'мл',confirmed:true,startDate:date,type:'prn'},model=familyPreview({people:[{id:'a',name:'Алиса'}],prescriptions:[rx]},{items:[],prn:[rx]},{date,now});
 assert.equal(Object.fromEntries(model.cards[0].prn[0].info.fields)['Форма'],'Раствор / сироп');
});

test('Конкретные часы видны в отдельных группах обзора, одинаковые часы объединяются',()=>{
  const person={id:'p',name:'Тест'},rx={id:'rx',personId:'p',name:'ТестЛекарство',dose:'1',unit:'табл.',confirmed:true,startDate:date};
  const items=['09:15','17:00','17:00'].map((time,i)=>({...rx,rxId:rx.id,key:'clock-'+i,anchor:'clock',displayTime:time}));
  const view=familyPreview({people:[person],prescriptions:[rx]},{items,prn:[]},{date,now:new Date(date+'T06:00:00Z')}).cards[0];
  const groups=[view.current,...view.earlier,...view.later];assert.deepEqual(groups.map(g=>g.label),['09:15','17:00']);assert.equal(groups[1].rows.length,2);assert.equal(Object.fromEntries(groups[1].rows[0].fields)['Время'],'17:00');
});

test('Рабочая отметка остаётся у свёрнутых прошлых и последующих приёмов; readOnly сохраняется',()=>{
 assert.match(careDrug('Тест','1 мл','',{later:true,showTake:true,actionKey:'planned'}),/data-take="planned"/);
 assert.match(careDrug('Тест','1 мл','',{later:true,showTake:true,readOnly:true,actionKey:'unassigned'}),/disabled/);
 assert.doesNotMatch(careDrug('Тест','1 мл','',{later:true}),/class="care-take/);
});
