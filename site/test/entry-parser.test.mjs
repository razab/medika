import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEntry,parseLocalEntry,spokenNumbers} from '../lib/entry-parser.mjs';
const state={people:[{id:'a',name:'Алиса',carePhase:'prevention'},{id:'d',name:'Даня',carePhase:'acute'}],documents:[],activities:[],prescriptions:[{id:'rx-a',personId:'a',name:'Elizium'}]};
const now=new Date('2026-11-08T18:00:00Z'),parse=(text,personId='a')=>parseEntry(state,{text,personId,timeZone:'Europe/Chisinau'},{now});
test('Фраза: пациент, симптомы, числа и явное время',()=>{
  assert.equal(parse('Дане рвота сейчас').personId,'d');assert.equal(parse('Дане рвота сейчас').carePhase,'acute');
  assert.equal(parse('Алиса температура 38,2 сейчас').celsius,'38.2');assert.equal(parse('температура тридцать восемь и два сейчас').celsius,'38.2');
  assert.equal(parse('Alice temperature thirty-eight point two now').celsius,'38.2');
  assert.equal(parse('температура 20.50 сейчас').celsius,'20.50');
  assert.equal(parse('вчера в 17:00 рвота').occurredAt,'2026-11-07T15:00:00.000Z');
  assert.equal(parse('позавчера в 17:00 рвота').occurredAt,'2026-11-06T15:00:00.000Z');
  assert.equal(parse('рвота вчера').occurredAt,'');assert.ok(parse('Алисе и Дане рвота').missing.includes('personId'));
});
test('Фраза: препарат связан с пациентом; концентрация не превращается в дозу',()=>{
  const r=parse('Алисе дали элизиум четыре миллилитра сейчас');assert.equal(r.name,'Elizium');assert.equal(r.amount,'4');assert.equal(r.unit,'мл');assert.equal(r.relatedRxId,'rx-a');
  const concentration=parse('дали Elizium 0,5 мг/мл 4 мл в 17:00');assert.equal(concentration.strength,'0,5 мг/мл');assert.equal(concentration.amount,'4');assert.equal(concentration.occurredAt,'2026-11-08T15:00:00.000Z');
  const suppository=parse('Алисе поставили парацетамол одну свечу 125 мг сейчас');assert.equal(suppository.amount,'1');assert.equal(suppository.unit,'свеча');assert.equal(suppository.strength,'125 мг');
  assert.equal(parse('ингаляция с водой 2 мл сейчас').name,'Вода');assert.equal(parse('дали Elizium сейчас').amount,'');
  assert.equal(parse('дали Elizium 2–5 мл сейчас').amount,'');assert.equal(parse('дали Elizium -1 мл сейчас').amount,'');
  assert.equal(parse('дали Elizium 2 - 5 мл сейчас').amount,'');
  assert.equal(spokenNumbers('половина мл'),'0.5 мл');assert.equal(spokenNumbers('полтаблетки'),'0.5 табл.');
});
test('Фраза: неоднозначность не создаёт ложных фактов',()=>{
  const decimal=parse('температура 38-2 сейчас');assert.equal(decimal.celsius,'38.2');assert.ok(decimal.notes.length);
  for(const text of ['температура 38-39 сейчас','температура 38,222 сейчас','температура -38,2 сейчас','температура 38 и 39','температура 38 2','температура 38 - 39'])assert.ok(parse(text).missing.includes('celsius'));
  assert.equal(parse('рвоты не было').kind,'other');
  for(const text of ['рвота; температура 38,2','температура 38,2 и рвота','температура 38,2 дали Elizium 4 мл','не дала Elizium','завтра в 17:00 рвота','врач назначил Elizium 4 мл'])assert.throws(()=>parse(text));
  assert.equal(parse('погуляли сейчас').kind,'other');
});
test('Общее событие: относительное время, таблетка, свечка и позывы',()=>{
  const temperature=parse('Даня, две минуты назад высокая температура 38,2');
  assert.equal(temperature.personId,'d');assert.equal(temperature.occurredAt,'2026-11-08T17:58:00.000Z');assert.equal(temperature.celsius,'38.2');assert.equal(temperature.canAutoRecord,true);
  assert.equal(parse('Даня, температура высокая, 38,2 две минуты назад').celsius,'38.2');
  assert.equal(parse('Даня, позывы к рвоте пять минут назад').kind,'retching');assert.equal(parse('Даня, позывы к рвоте пять минут назад').canAutoRecord,true);
  for(const [text,u] of [['Даня получил таблетку парацетамола 250 мг пять минут назад','табл.'],['Даня получил свечку парацетамола 125 мг минуту назад','свеча']]){
    const r=parse(text);assert.equal(r.kind,'medication');assert.equal(r.unit,u);assert.equal(r.amount,'1');assert.equal(r.name,'парацетамола');assert.ok(r.strength);assert.equal(r.canAutoRecord,true);
  }
  assert.equal(parse('Даня получил две таблетки парацетамола 250 мг десять минут назад').amount,'2');
  assert.equal(parse('Danya received a tablet of paracetamol two minutes ago').unit,'табл.');
  assert.equal(parse('Даня, рвота полчаса назад').occurredAt,'2026-11-08T17:30:00.000Z');
  assert.equal(parse('Даня, рвота пару минут назад').occurredAt,'2026-11-08T17:58:00.000Z');
  assert.equal(parseEntry(state,{text:'Даня температура 39 две минуты назад',recordedAt:'2026-11-08T17:00:00Z'},{now}).occurredAt,'2026-11-08T16:58:00.000Z');
  for(const text of ['Даня рвота 2 - 3 минуты назад','Даня рвота несколько минут назад','Даня рвота час и десять минут назад','Даня высокая температура','температура 38,2','Даня получил таблетку','Даня рвоты не было'])assert.equal(parse(text).canAutoRecord,false,text);
});

test('Локальный голос: согласованные измерения сохраняются, лекарства и расхождения идут на сверку',()=>{
  const parse=(small,medium)=>parseLocalEntry(state,{text:`Whisper Small:\n${small}\n\nWhisper Medium:\n${medium}`,recordedAt:now.toISOString()},{now});
  const ru='Алиса температура 38,2 две минуты назад';
  const measurement=parse(ru,'Алиса температура 38.2 2 минуты назад');
  assert.equal(measurement.canAutoRecord,true);
  assert.equal(measurement.occurredAt,'2026-11-08T17:58:00.000Z');
  for(const disagree of ['Даня температура 38,2 две минуты назад','Алиса температура 38,1 две минуты назад','Алиса температура 38,2 минуту назад','Алиса рвота; температура 38,2']){
    const draft=parse(ru,disagree);
    assert.equal(draft.canAutoRecord,false);
    assert.equal(draft.celsius,'');
    assert.ok(draft.notes.length);
  }
  const medication='Алисе дали Elizium четыре миллилитра сейчас';
  assert.equal(parse(medication,medication).amount,'4');
  assert.equal(parse(medication,medication).canAutoRecord,false);
  assert.equal(parseLocalEntry(state,{text:ru},{now}).canAutoRecord,false);
});
