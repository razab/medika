import test from 'node:test';
import strict from 'node:assert/strict';
import {rxInput,personInput,scheduleFor,zonedInstant,parseSuggestions,day,localParts,courseEnd} from '../lib/domain.mjs';
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
  strict.equal(parseSuggestions('Название похоже на ТестПрепарат 600 мг, требует сверки').length,0);
  strict.equal(parseSuggestions('ТестКомбо, спрей (10 мг + 5 мг/мл) — по 2 впрыскивания в каждую ноздрю')[0].strength,'10 мг + 5 мг/мл');
});
test('Многострочные назначения сохраняют время, длительность и дозу на каждую ноздрю',()=>{
  const suggestions=parseSuggestions('1. ТестСпрей 50 мкг/доза — по 1 впрыскиванию в каждую ноздрю вечером,\nв течение 2 месяцев.\n2. ТестРаствор, раствор 0,5 мг/мл, 120 мл — по 4 мл 1 раз\nв день, в 17:00, в течение 2 месяцев.');
  strict.equal(suggestions.length,2);strict.equal(suggestions[0].dose,'1');strict.equal(suggestions[0].unit,'впрыскивание');strict.equal(suggestions[0].doseScope,'each-nostril');strict.match(suggestions[0].sourceText,/2 месяцев/);strict.equal(suggestions[1].strength,'0,5 мг/мл');strict.equal(suggestions[1].times,'17:00');
});
test('Условная ветка и относительный интервал сохраняются для сверки',()=>{
  const suggestions=parseSuggestions('При появлении окрашенных выделений из носа рекомендуется\nследующая лечебная тактика:\n• ТестСпрейА, спрей 10 мг/мл — по 2 впрыскивания\nв каждую ноздрю 3 раза в день, не более 10 дней.\nЧерез 10–15 минут после применения ТестСпрейА использовать\nТестСпрейБ, назальный спрей — по 1 впрыскиванию в каждую ноздрю\n3 раза в день, в течение 5–7 дней.');
  strict.equal(suggestions.length,2);strict.ok(suggestions.every(s=>s.requiresReview));strict.match(suggestions[1].sourceText,/10–15 минут/);strict.match(suggestions[1].conditions,/условн/iu);
});
test('Расписание по выходным не создаёт приёмы в будни',()=>{
  const r=rx({weekdays:[0,6]});strict.equal(scheduleFor(r,'2026-11-08').length,2);strict.equal(scheduleFor(r,'2026-11-09').length,0);
  strict.throws(()=>rx({weekdays:[]}));
});
test('Дни, недели и календарные месяцы имеют явные включительные границы',()=>{
  strict.equal(courseEnd('2026-11-08',7,'days'),'2026-11-14');strict.equal(courseEnd('2026-11-08',6,'weeks'),'2026-12-19');strict.equal(courseEnd('2026-11-08',2,'months'),'2027-01-07');strict.equal(courseEnd('2028-01-31',1,'months'),'2028-02-28');strict.throws(()=>courseEnd('2026-11-08',0,'days'));
  strict.deepEqual(personInput({name:'Ребёнок',ageYears:4,ageAsOf:'2026-11-08'}).birthday,'');
});
test('Проверки изолируют людей; известные, неизвестные и повтор вещества различаются',()=>{
  const state={people:[{id:'p1',allergies:'ибупрофен'}],prescriptions:[rx(),{...rx({ingredients:'варфарин'}),id:'rx2',personId:'p2'}],events:[]};
  strict.equal(checkPerson(state,{at:'2026-11-09T10:00:00Z',personId:'p1'}).findings.filter(f=>f.id.startsWith('warfarin')).length,0);
  const result=checkPerson(state,{at:'2026-11-09T10:00:00Z',personId:'p1',candidate:{name:'Новый препарат',ingredients:['warfarin']}});strict.ok(result.findings.some(f=>f.id.startsWith('warfarin')));strict.equal(result.status,'incomplete');
  strict.ok(checkPerson(state,{at:'2026-11-09T10:00:00Z',personId:'p1',candidate:{name:'Копия',ingredients:['ibuprofen']}}).findings.some(f=>f.id.startsWith('duplicate')));
  strict.ok(checkPerson(state,{at:'2026-11-09T10:00:00Z',personId:'p1',candidate:{name:'Неизвестное',ingredients:[]}}).unknown.length);
  strict.ok(result.findings.some(f=>f.id.startsWith('allergy')));
});
test('Число фактических приёмов за скользящие 24 часа и минимальный интервал',()=>{
  const r=rx({minHours:'8',maxPer24h:'1'});const state={events:[{rxId:r.id,status:'taken',occurredAt:'2026-11-08T08:00:00Z'},{rxId:r.id,status:'void',occurredAt:'2026-11-08T09:00:00Z'}]};strict.equal(intakeWarnings(state,r,'2026-11-08T09:00:00Z').length,2);strict.equal(intakeWarnings(state,r,'2026-11-09T08:00:00Z').length,0);
});
