import test from 'node:test';
import assert from 'node:assert/strict';
import {familyPreview,shortDose} from '../public/family-preview-model.js';
import {careDrug,careFamily} from '../public/family-card.js';
const date='2026-11-09',now=new Date('2026-11-09T18:00:00Z');
test('A1: только подтверждённый текущий курс своего человека; слоты и интервалы сохраняются без домысливания',()=>{
  const people=[{id:'a',name:'Тест А',carePhase:'acute'},{id:'b',name:'Тест Б',carePhase:'prevention'}];
  const base={id:'rx',personId:'a',name:'ТестСпрей',dose:'2',unit:'впрыскивание',doseScope:'each-nostril',confirmed:true,startDate:'2026-11-01',endDate:'2026-11-20',carePhase:'acute',sourceText:'Через 10–15 минут после применения ТестПервый использовать ТестСпрей.'};
  const prescriptions=[base,{...base,id:'future',startDate:'2026-11-10'},{...base,id:'unconfirmed',confirmed:false},{...base,id:'other-phase',carePhase:'prevention'},{...base,id:'archived',archived:true},{...base,id:'other-person',personId:'b'}];
  const row={rxId:'rx',personId:'a',name:base.name,dose:base.dose,unit:base.unit,doseScope:base.doseScope};
  const items=[{...row,anchor:'breakfast',label:'Завтрак',displayTime:'07:30'},{...row,anchor:'dinner',label:'Ужин',displayTime:'19:00'},{...row,anchor:'clock',displayTime:'23:00'},...prescriptions.slice(1).map(r=>({...row,rxId:r.id,anchor:'dinner'})),{...row,historical:true,anchor:'dinner'}];
  const model=familyPreview({people,prescriptions},{items,prn:[]},{date,now});
  assert.equal(model.cards[0].phase,'Острая фаза');assert.equal(model.cards[0].current.label,'Ужин');assert.equal(model.cards[0].current.rows.length,1);assert.equal(model.cards[0].earlier[0].label,'Завтрак');assert.equal(model.cards[0].later[0].label,'Отдельные приёмы');
  assert.equal(model.cards[0].current.rows[0].dose,'2 пшика');assert.match(model.cards[0].current.rows[0].instruction,/2 впрыскивания в каждую ноздрю/);assert.equal(model.cards[0].current.rows[0].after,'Через 10–15 мин после ТестПервый');assert.match(model.cards[0].later[0].rows[0].instruction,/23:00/);
  assert.equal(model.cards[1].current,null);assert.equal(model.cards[1].phase,'Поддерживающая');
  const early=familyPreview({people,prescriptions},{items,prn:[]},{date,now:new Date('2026-11-09T03:00:00Z')});assert.equal(early.cards[0].current.label,'Завтрак');
  const late=familyPreview({people,prescriptions},{items,prn:[]},{date,now:new Date('2026-11-09T21:30:00Z')});assert.equal(late.cards[0].current.label,'Отдельные приёмы');
  const family=[{id:'dad',name:'Папа'},{id:'mom',name:'Мама'},{id:'child',name:'Алиса'}],sorted=familyPreview({people:family,prescriptions:[]},{items:[],prn:[]},{date,now});assert.deepEqual(sorted.cards.map(p=>p.id),['child','mom','dad']);assert.deepEqual(family.map(p=>p.id),['dad','mom','child']);
});
test('A1: факт сохраняет свою дозу, отменённые/будущие/вчерашние события не становятся текущими',()=>{
  const rx={id:'rx',personId:'a',name:'ТестИзменён',dose:'9',unit:'мл',confirmed:true,startDate:'2026-11-01'};
  const fact={id:'fact',personId:'a',name:'ТестИсходный',actualDose:'2.5',unit:'мл',status:'taken',occurredAt:'2026-11-09T16:00:00Z',timeZone:'Europe/Chisinau'};
  const model=familyPreview({people:[{id:'a',name:'Тест'}],prescriptions:[rx],events:[fact],activities:[{personId:'a',kind:'temperature',celsius:37.7,status:'recorded',occurredAt:'2026-11-09T17:00:00Z'},{kind:'temperature',celsius:38,occurredAt:'2026-11-09T19:00:00Z'},{...fact,id:'void',status:'void'},{...fact,id:'yesterday',occurredAt:'2026-11-08T12:00:00Z'}]},{items:[{...rx,rxId:rx.id,anchor:'unassigned',event:fact}],prn:[]},{date,now});
  assert.equal(model.cards[0].current.label,'Нужно привязать приём');assert.equal(model.cards[0].current.rows[0].name,'ТестИсходный');assert.equal(model.cards[0].current.rows[0].dose,'2,5 мл');assert.equal(model.history.length,2);assert.equal(model.history[0].name,'37,7 °C');assert.equal(model.history[1].detail,'2.5 мл принято');
});
test('A1: короткие пшики не изменяют источник; данные экранируются, реальные отметки доступны только для чтения',()=>{
  for(const [dose,text]of [[1,'1 пшик'],[2,'2 пшика'],[5,'5 пшиков'],[11,'11 пшиков'],[21,'21 пшик'],[22,'22 пшика']])assert.equal(shortDose({dose,unit:'впрыскивание'}),text);
  const html=careDrug('<script>bad</script>','2 мл','<img src=x onerror=bad>',{readOnly:true,taken:true});assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/disabled checked/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(careFamily([{id:'a" onfocus="bad',name:'<img>'}]),/<img|value="a" onfocus/);
  const inhalation=familyPreview({people:[],prescriptions:[],activities:[{kind:'inhalation',name:'ТестРаствор',amount:'2',unit:'мл',occurredAt:'2026-11-09T16:00:00Z'}]},{items:[],prn:[]},{date,now}).history[0];assert.equal(inhalation.name,'Ингаляция · ТестРаствор');
});
