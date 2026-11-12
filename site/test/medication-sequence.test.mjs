import test from 'node:test';
import assert from 'node:assert/strict';
import {medicineInput,validateMedicineSequence} from '../lib/medicines.mjs';
import {dependencyTimer} from '../public/design-study/a1-events.js';
const first={key:'morning',personId:'p',prescriptionId:'first-morning',anchor:'breakfast',slotIndex:0},evening={...first,key:'evening',prescriptionId:'first-evening',anchor:'secondDinner'},second={key:'second-evening',personId:'p',prescriptionId:'second',anchor:'secondDinner',slotIndex:1,dependency:{prescriptionIds:['first-morning','first-evening'],matching:'anchor',minMinutes:15,maxMinutes:30}};
const snapshot={plans:[first,evening,second],model:{cards:[],history:[]}},start=Date.parse('2026-11-12T17:00:00Z'),event={id:'fact',personId:'p',rowKey:'evening',kind:'medication',status:'taken',occurredAt:new Date(start).toISOString()};
test('Таймер: другой рецепт того же препарата, правильные человек/слот, границы 15–30 минут и отмена',()=>{
 assert.equal(dependencyTimer(snapshot,[{...event,rowKey:'morning'}],second,start).state,'missing');
 assert.equal(dependencyTimer(snapshot,[{...event,personId:'other-person'}],second,start).state,'missing');
 assert.equal(dependencyTimer(snapshot,[event],second,start).text,'До второго препарата 15:00');
 assert.equal(dependencyTimer(snapshot,[event],second,start+15*60000).state,'ready');
 assert.equal(dependencyTimer(snapshot,[event],second,start+30*60000).state,'ready');
 assert.equal(dependencyTimer(snapshot,[event],second,start+30*60000+1).state,'expired');
 assert.equal(dependencyTimer(snapshot,[{...event,occurredAt:null}],second,start).state,'unknown');
 assert.equal(dependencyTimer(snapshot,[event,{id:'cancel',kind:'cancel',targetId:event.id}],second,start).state,'missing');
 assert.equal(dependencyTimer(snapshot,[event,{...event,id:'second-fact',rowKey:second.key}],second,start),null);
 assert.equal(dependencyTimer(snapshot,[{...event,status:'skipped'}],second,start).state,'missing');
});
test('Последовательность: только известные препараты, целый интервал, без циклов; напоминание сохраняется отдельно от справки',()=>{
 const first={id:'first',name:'Первый'},input={name:'Второй',medicineForm:'inhalation',aftercare:'Тестовое напоминание',afterMedicine:{medicineId:first.id,minMinutes:15,maxMinutes:30}},second={id:'second',...medicineInput(input)};
 validateMedicineSequence(second,[first]);assert.equal(second.afterMedicine.source,'user');assert.equal(second.aftercare,input.aftercare);
 for(const values of [[0,30],[30,15],[15.5,30],[15,1441]])assert.throws(()=>medicineInput({...input,afterMedicine:{...input.afterMedicine,minMinutes:values[0],maxMinutes:values[1]}}));
 assert.throws(()=>validateMedicineSequence(second,[]));assert.throws(()=>validateMedicineSequence({...second,afterMedicine:{...second.afterMedicine,medicineId:second.id}},[first,second]));
 assert.throws(()=>validateMedicineSequence(second,[{...first,afterMedicine:{medicineId:second.id}},second]));
 assert.equal(medicineInput({...input,afterMedicine:null}).afterMedicine,null);
});

test('Активное окно переходит через полночь и не повторяется после уже записанного второго приёма',()=>{
 const before='2026-11-12',after='2026-11-13',source={...evening,key:'first-evening@routine-'+after+'-0'},target={...second,key:'second@routine-'+after+'-1'},old={...event,rowKey:'first-evening@routine-'+before+'-0',occurredAt:before+'T21:50:00Z'},view={plans:[source,target],model:{cards:[],history:[old]}},now=Date.parse(before+'T22:05:00Z');
 assert.equal(dependencyTimer(view,[],target,now).state,'ready');
 const given={...old,id:'second-fact',rowKey:'second@routine-'+before+'-1',occurredAt:before+'T22:04:00Z'};assert.equal(dependencyTimer(view,[given],target,now),null);
 assert.equal(dependencyTimer(view,[{kind:'cancel',id:'void',targetId:old.id}],target,now).state,'missing');
});
