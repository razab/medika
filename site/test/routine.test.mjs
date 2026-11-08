import test from 'node:test';
import assert from 'node:assert/strict';
import {personInput,rxInput,scheduleFor} from '../lib/domain.mjs';
import {emptyRoutine} from '../public/routine.js';
const routine=emptyRoutine();
routine.weekday={times:{breakfast:'08:00',dinner:'18:00–19:00'},intakes:['breakfast','dinner','']};
routine.weekend={times:{breakfast:'09:00',lunch:'13:00'},intakes:['breakfast','lunch','']};
const person=personInput({name:'Тест',routine});
const rx={id:'rx',personId:'p',...rxInput({name:'Тест',dose:'1',unit:'табл.',startDate:'2026-11-01',endDate:'2026-11-10',type:'routine',routineSlots:[{anchor:'first'},{anchor:'second'},{anchor:'third'}],timeZone:'Europe/Chisinau',confirmed:true})};
test('Личные будни/выходные, диапазон и неизвестный третий не превращаются в выдуманные часы',()=>{
  const weekday=scheduleFor(rx,'2026-11-09',person),weekend=scheduleFor(rx,'2026-11-08',person);
  assert.deepEqual(weekday.map(s=>s.anchor),['breakfast','dinner','unassigned']);
  assert.deepEqual(weekday.map(s=>s.displayTime),['08:00','18:00–19:00','']);
  assert.equal(weekday[1].scheduledAt,undefined);assert.equal(weekday[2].scheduledAt,undefined);
  assert.deepEqual(weekend.map(s=>s.displayTime),['09:00','13:00','']);
  const danya=structuredClone(person);danya.routine.weekday.intakes[1]='lunch';
  assert.equal(scheduleFor(rx,'2026-11-09',danya)[1].anchor,'lunch');
  assert.equal(scheduleFor(rx,'2026-10-31',person).length,0);
  assert.equal(scheduleFor(rx,'2026-11-11',person).length,0);
});
test('Ключ факта стабилен при изменении часов; врачебные часы и интервалы сохраняются',()=>{
  const before=scheduleFor(rx,'2026-11-09',person),changed=structuredClone(person);changed.routine.weekday.times.breakfast='10:00';
  const after=scheduleFor(rx,'2026-11-09',changed);assert.equal(before[0].key,after[0].key);assert.notEqual(before[0].scheduledAt,after[0].scheduledAt);
  const daily={...rx,type:'daily',times:['17:00']};assert.equal(scheduleFor(daily,'2026-11-09',changed)[0].time,'17:00');
  const relation={...rx,routineSlots:[{anchor:'breakfast',relation:'before'}]};assert.equal(scheduleFor(relation,'2026-11-09',person)[0].scheduledAt,undefined);
  const sequence={...rx,routineSlots:[{anchor:'first',offsetMinutes:15}]};assert.equal(scheduleFor(sequence,'2026-11-09',person)[0].time,'08:00');
  assert.deepEqual(rxInput({...rx,ingredients:'',routineSlots:[{anchor:'first',offsetMinutes:15}]}).routineSlots,[{anchor:'first',relation:''}]);
  assert.equal(scheduleFor({...rx,routineSlots:[{anchor:'secondDinner'}]},'2026-11-09',person)[0].label,'Второй ужин');
});
test('Распорядок и слоты проверяются на границе ввода',()=>{
  assert.deepEqual(emptyRoutine().weekday.intakes,['breakfast','lunch','dinner']);
  for(const value of ['25:00','19:00–18:00','8:00','08:00–09:00–10:00']){
    const bad=structuredClone(routine);bad.weekday.times.breakfast=value;assert.throws(()=>personInput({name:'Тест',routine:bad}));
  }
  for(const s of [{anchor:'bad'},{anchor:'clock',time:'25:00'},{anchor:'bedtime',relation:'after'}])assert.throws(()=>rxInput({...rx,ingredients:'',routineSlots:[s]}));
});
