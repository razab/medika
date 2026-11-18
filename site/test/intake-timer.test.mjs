import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeTimer,prescribedInterval} from '../public/intake-timer.js';

const start=Date.parse('2026-11-18T06:00:00Z');
const input={personId:'p',name:'ТестПрепарат',medicineId:'m',minHours:'12',timeZone:'Europe/Chisinau'};
const row={personId:'p',prescriptionId:'r'};
const event={id:'fact',personId:'p',prescriptionId:'r',kind:'medication',status:'taken',occurredAt:new Date(start).toISOString(),date:'2026-11-18'};
const snapshot={prescriptions:[{id:'r',personId:'p',name:input.name,input}],model:{history:[event]}};

test('Интервал от факта проходит через полночь, изменение часов, перезагрузку, отмену и исправление',()=>{
  assert.match(intakeTimer(snapshot,row,start).text,/12:00:00/);
  assert.equal(intakeTimer(snapshot,row,start+12*3600000).state,'elapsed');
  const copy=structuredClone(snapshot);
  copy.model.history[0].occurredAt=new Date(start+3600000).toISOString();
  assert.match(intakeTimer(copy,row,start+2*3600000).text,/11:00:00/);
  copy.model.history[0].status='void';
  assert.equal(intakeTimer(copy,row,start+2*3600000),null);
  copy.model.history=[{...event,personId:'other'}];
  assert.equal(intakeTimer(copy,row,start),null);
});

test('Разные назначения одного препарата и свободная запись учитываются, другой человек исключён',()=>{
  const copy=structuredClone(snapshot);
  copy.prescriptions.push({id:'evening',personId:'p',name:input.name,input});
  copy.model.history=[{...event,prescriptionId:'evening'}];
  assert.match(intakeTimer(copy,row,start).text,/12:00:00/);
  copy.model.history=[{...event,prescriptionId:'',input:{name:input.name}}];
  assert.equal(intakeTimer(copy,row,start).state,'waiting');
});

test('Неизвестное время не даёт отсчёт, максимум за скользящие сутки учитывает отмену',()=>{
  const copy=structuredClone(snapshot);
  copy.model.history=[{...event,occurredAt:null}];
  assert.equal(intakeTimer(copy,row,start).state,'unknown');
  copy.prescriptions[0].input={...input,minHours:'6',maxPer24h:'2'};
  copy.model.history=[event,{...event,id:'second',occurredAt:new Date(start+6*3600000).toISOString()}];
  assert.match(intakeTimer(copy,row,start+12*3600000).text,/Достигнут максимум/);
  assert.equal(intakeTimer(copy,row,start+24*3600000).state,'elapsed');
  copy.model.history[0].status='void';
  assert.equal(intakeTimer(copy,row,start+12*3600000).state,'elapsed');
});

test('Число приёмов само по себе не назначает интервал, явное указание часов читается',()=>{
  assert.equal(prescribedInterval({sourceText:'2 раза в день'}),null);
  assert.equal(prescribedInterval({sourceText:'каждые 12 часов'}).hours,12);
  assert.equal(prescribedInterval({conditions:'не ранее чем через 6 ч'}).hours,6);
  assert.equal(prescribedInterval({type:'interval',intervalHours:8}).hours,8);
});
