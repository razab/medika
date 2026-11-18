import test from 'node:test';
import assert from 'node:assert/strict';
import {courseSupply} from '../lib/course-supply.mjs';
import {scheduleFor} from '../lib/domain.mjs';

const date='2026-11-18',now=new Date(date+'T12:00:00Z');
const people=[{id:'a',name:'Первый',carePhase:'acute'},{id:'b',name:'Второй',carePhase:'acute'}];
const rx={id:'rx-a',personId:'a',name:'ТестТаблетки',medicineForm:'tablet',strength:'100 mg',unit:'табл.',dose:'0.5',type:'routine',routineSlots:[{anchor:'breakfast'},{anchor:'dinner'}],startDate:date,endDate:'2026-11-20',confirmed:true,carePhase:'acute',timeZone:'Europe/Chisinau'};
const make=(prescriptions,events=[])=>({people,prescriptions,events,medicines:[]});

test('Потребность семьи объединяет один препарат, вычитает записанное, сохраняет дробные дозы и остаток других людей',()=>{
  const second={...rx,id:'rx-b',personId:'b',dose:'2'};
  const first=scheduleFor(rx,date,people[0])[0];
  const event={...first,status:'taken',actualDose:'0.25'};
  const result=courseSupply(make([rx,second],[event]),{date,now});
  assert.equal(result.length,1);
  assert.equal(result[0].total,14.5);
  assert.deepEqual(result[0].people.map(p=>p.amount),[2.5,12]);
  assert.equal(courseSupply(make([rx,second],[{...event,status:'void'}]),{date,now})[0].total,15);
});

test('Разные концентрации, формы и единицы остаются отдельными, без даты окончания и PRN обозначаются неполными',()=>{
  const result=courseSupply(make([rx,{...rx,id:'strength',strength:'200 mg'},{...rx,id:'capsule',medicineForm:'capsule'},{...rx,id:'unit',unit:'мг'},{...rx,id:'open',endDate:''},{...rx,id:'prn',type:'prn'}]),{date,now});
  assert.equal(result.length,4);
  const tablet=result.find(r=>r.strength==='100 mg'&&r.unit==='табл.'&&r.incomplete.length);
  assert.equal(tablet.total,3);
  assert.equal(tablet.incomplete.length,2);
});

test('Начало в будущем, конец включительно, дни недели, прошедшие часы и разовый курс',()=>{
  const future={...rx,startDate:'2026-11-19',weekdays:[4]};
  assert.equal(courseSupply(make([future]),{date,now})[0].total,1);
  const daily={...rx,type:'daily',times:['08:00','18:00'],routineSlots:[],endDate:date,dose:'1'};
  assert.equal(courseSupply(make([daily]),{date,now})[0].total,1);
  const single={...daily,type:'once',times:['18:00'],endDate:''};
  assert.equal(courseSupply(make([single]),{date,now})[0].total,1);
  assert.deepEqual(courseSupply(make([{...rx,carePhase:'prevention'},{...rx,archived:true},{...rx,confirmed:false},{...rx,endDate:'2026-11-17'}]),{date,now}),[]);
});

test('Интервальный курс и сохранённый ключ прежнего расписания учитываются один раз',()=>{
  const interval={...rx,type:'interval',anchor:date+'T06:00:00Z',intervalHours:12,endDate:'2026-11-19',dose:'1'};
  assert.equal(courseSupply(make([interval]),{date,now})[0].total,3);
  const legacy={...rx,legacyTimes:['08:00','18:00']};
  const slot=scheduleFor(legacy,date,people[0])[0];
  assert.equal(courseSupply(make([legacy],[{rxId:rx.id,key:slot.legacyKey,date,status:'taken'}]),{date,now})[0].total,2.5);
});
