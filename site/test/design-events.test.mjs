import test from 'node:test';
import assert from 'node:assert/strict';
import {rowEvent,dependencyStatus,activeEvents,localInstant,courseWarnings} from '../public/design-study/a1-events.js';
const a={key:'a',personId:'p',prescriptionId:'r1',slotIndex:0,slotLabel:'Ужин',name:'Первый',dose:'2 пшика'},b={key:'b',personId:'p',prescriptionId:'r2',slotIndex:0,slotLabel:'Ужин',dependency:{prescriptionId:'r1',minMinutes:10,maxMinutes:15}};
const snapshot={contextAt:'2026-11-09T17:00:00Z',model:{cards:[{id:'p',current:{rows:[a,b]},later:[],earlier:[],prn:[]}],history:[]}};
test('Демо: интервал связан с фактом того же человека и повторения, отмена снимает связь',()=>{
  const actions=[{id:'1',kind:'medication',rowKey:'a',personId:'p',occurredAt:'2026-11-09T16:48:00Z',detail:'2 пшика'}];
  assert.match(dependencyStatus(snapshot,[],b),/Нет записи/);assert.match(dependencyStatus(snapshot,actions,b),/12 мин · интервал 10–15/);assert.equal(rowEvent(snapshot,actions,a).id,'1');
  const cancelled=[...actions,{id:'2',kind:'cancel',targetId:'1'}];assert.equal(rowEvent(snapshot,cancelled,a),null);assert.equal(activeEvents(snapshot,cancelled).length,0);assert.match(dependencyStatus(snapshot,cancelled,b),/Нет записи/);assert.equal(actions.length,1);
  const otherSlot={...b,slotIndex:1};assert.match(dependencyStatus(snapshot,actions,otherSlot),/Нет записи/);
  assert.match(dependencyStatus(snapshot,[{...actions[0],occurredAt:null}],b),/неизвестно/);
});
test('Демо: исходный факт отменяется по его ID; повторная запись не теряет аудит',()=>{
  const row={...a,taken:true,takenAt:'2026-11-09T16:00:00Z'},source={...snapshot,model:{...snapshot.model,history:[{id:'original',prescriptionId:'r1',occurredAt:row.takenAt,personId:'p',detail:'1 пшик'}]}};
  assert.equal(rowEvent(source,[],row).id,'original');const cancel={id:'cancel',kind:'cancel',targetId:'original'};assert.equal(rowEvent(source,[cancel],row),null);
  const retry={id:'retry',kind:'medication',rowKey:'a',personId:'p',occurredAt:null,detail:'2 пшика'};assert.equal(rowEvent(source,[cancel,retry],row).id,'retry');assert.equal(source.model.history[0].detail,'1 пшик');
});
test('Демо: местное время переводится явно, курсы сравниваются с текстовым пределом без исправления',()=>{
  assert.equal(localInstant('2026-11-09','14:30','Europe/Chisinau'),'2026-11-09T12:30:00.000Z');assert.throws(()=>localInstant('','', 'Europe/Chisinau'));
  const rx={startDate:'2026-11-06',endDate:'2026-11-17',maxDays:10,durationText:'не более 10 дней'};assert.match(courseWarnings(rx,'2026-11-09')[0],/12 дней/);assert.equal(rx.endDate,'2026-11-17');
});
