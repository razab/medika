import test from 'node:test';
import strict from 'node:assert/strict';
import {rxInput,personInput,scheduleFor,zonedInstant,parseSuggestions,day,localParts} from '../lib/domain.mjs';
import {checkPerson,intakeWarnings} from '../lib/reference.mjs';

const sample={name:'Тестовое средство',dose:'0,5',unit:'табл.',ingredients:'ибупрофен',startDate:'2026-11-08',endDate:'2026-11-10',type:'daily',times:'08:00, 20:00',timeZone:'Europe/Chisinau',confirmed:true};
const rx=(input={})=>({id:'rx1',personId:'p1',...rxInput({...sample,...input})});
test('Доза и концентрация разделены; подтверждение и положительная доза обязательны',()=>{
  strict.equal(rx({strength:'100 мг / 5 мл'}).dose,'0.5');
  for(const data of [{dose:'0'},{dose:'-2'},{confirmed:false},{times:'25:00'},{maxPer24h:'1.5'},{endDate:'2026-11-07'},{type:'interval',intervalHours:0,anchorTime:'08:00'}])strict.throws(()=>rx(data));
  for(const date of ['2026-02-30','2026-99-99','x'])strict.throws(()=>day(date),/дата/iu);
  strict.throws(()=>personInput({name:'',weight:'3'}));
});
test('Точные границы курса включены; дни до и после пустые',()=>{
  const r=rx();strict.equal(scheduleFor(r,'2026-11-07').length,0);strict.equal(scheduleFor(r,'2026-11-08').length,2);strict.equal(scheduleFor(r,'2026-11-10').length,2);strict.equal(scheduleFor(r,'2026-11-11').length,0);
  strict.equal(scheduleFor({...r,archived:true},'2026-11-08').length,0);
});
test('Интервалы сохраняют прошедшее время через полночь и переход DST',()=>{
  const r=rx({type:'interval',startDate:'2026-10-24',endDate:'2026-10-26',anchorTime:'22:00',intervalHours:'8'});
  const events=['2026-10-24','2026-10-25','2026-10-26'].flatMap(d=>scheduleFor(r,d));
  for(let i=1;i<events.length;i++)strict.equal(Date.parse(events[i].scheduledAt)-Date.parse(events[i-1].scheduledAt),8*3600000);
  strict.equal(scheduleFor(r,'2026-10-25')[0].time,'05:00');
  strict.throws(()=>zonedInstant('2026-03-29','03:30','Europe/Chisinau'),/не существует/);
  const repeated=zonedInstant('2026-10-25','03:30','Europe/Chisinau');strict.equal(repeated,'2026-10-25T00:30:00.000Z');
  strict.deepEqual(localParts(repeated,'Europe/Chisinau'),{date:'2026-10-25',time:'03:30'});
});
test('Разовый и по необходимости не создают ежедневный обязательный курс',()=>{
  strict.equal(scheduleFor(rx({type:'once',times:'10:30'}),'2026-11-08').length,1);strict.equal(scheduleFor(rx({type:'once',times:'10:30'}),'2026-11-09').length,0);strict.equal(scheduleFor(rx({type:'prn'}),'2026-11-08').length,0);
});
test('OCR не путает концентрацию с дозой и не придумывает часы',()=>{
  const [p]=parseSuggestions('Ибупрофен 100 мг/5 мл по 2,5 мл 2 раза в день');strict.equal(p.dose,'2.5');strict.equal(p.unit,'мл');strict.equal(p.strength,'100 мг/5 мл');strict.equal(p.times,undefined);
  strict.equal(parseSuggestions('Неизвестное средство 250 мг 2 раза в день')[0].dose,'');
  strict.equal(parseSuggestions('1. Ибупрофен 100 мг/5 мл по 2,5 мл')[0].name,'Ибупрофен');
  strict.equal(parseSuggestions('Витамин B12 100 мг по 1 табл.')[0].name,'Витамин B12');
});
test('Проверки изолируют людей; известные, неизвестные и повтор вещества различаются',()=>{
  const state={people:[{id:'p1',allergies:'ибупрофен'}],prescriptions:[rx(),{...rx({ingredients:'варфарин'}),id:'rx2',personId:'p2'}],events:[]};
  strict.equal(checkPerson(state,{personId:'p1'}).findings.filter(f=>f.id.startsWith('warfarin')).length,0);
  const result=checkPerson(state,{personId:'p1',candidate:{name:'Новый препарат',ingredients:['warfarin']}});strict.ok(result.findings.some(f=>f.id.startsWith('warfarin')));strict.equal(result.status,'incomplete');
  strict.ok(checkPerson(state,{personId:'p1',candidate:{name:'Копия',ingredients:['ibuprofen']}}).findings.some(f=>f.id.startsWith('duplicate')));
  strict.ok(checkPerson(state,{personId:'p1',candidate:{name:'Неизвестное',ingredients:[]}}).unknown.length);
  strict.ok(result.findings.some(f=>f.id.startsWith('allergy')));
});
test('Число фактических приёмов за скользящие 24 часа и минимальный интервал',()=>{
  const r=rx({minHours:'8',maxPer24h:'1'});const state={events:[{rxId:r.id,status:'taken',occurredAt:'2026-11-08T08:00:00Z'},{rxId:r.id,status:'void',occurredAt:'2026-11-08T09:00:00Z'}]};strict.equal(intakeWarnings(state,r,'2026-11-08T09:00:00Z').length,2);strict.equal(intakeWarnings(state,r,'2026-11-09T08:00:00Z').length,0);
});
