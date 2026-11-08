import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCodexDraft,codexPeople,knownMedicines} from '../lib/codex-parser.mjs';
const state={people:[{id:'a',name:'Алиса'},{id:'d',name:'Даня',carePhase:'acute'},{id:'m',name:'Мама'},{id:'p',name:'Папа'}],prescriptions:[{id:'r',personId:'d',name:'ТестПрепарат'}]};
const recordedAt=new Date(Date.now()-60000).toISOString();
const output={personId:'d',kind:'temperature',name:'',amount:'',unit:'',strength:'',celsius:'38.2',timeMode:'relative',secondsAgo:120,date:'',clock:'',needsReview:false,notes:[]};
const parse=(text,change={})=>validateCodexDraft(state,{text,recordedAt,timeZone:'Europe/Chisinau'},{...output,...change});
test('Terra: проверка человека, времени, дозы и связи до записи',()=>{
  const t=parse('Даня, две минуты назад температура 38,2');assert.equal(t.personId,'d');assert.equal(t.carePhase,'acute');assert.equal(Date.parse(t.occurredAt),Date.parse(recordedAt)-120000);assert.equal(t.canAutoRecord,true);
  for(const text of ['температура 38,2','Алиса температура 38,2','Даня и Алиса температура 38,2'])assert.equal(parse(text).canAutoRecord,false);
  assert.equal(parse('Даня температура',{celsius:'38-39'}).canAutoRecord,false);
  assert.equal(parse('Даня рвота',{secondsAgo:-10}).canAutoRecord,false);
  assert.equal(parse('Даня рвота вчера',{timeMode:'unknown'}).canAutoRecord,false);
  assert.equal(parse('Даня не получил таблетку',{needsReview:true}).canAutoRecord,false);
  const med={kind:'medication',name:'ТестПрепарат',amount:'1',unit:'свеча',strength:'125 мг',celsius:''};
  assert.equal(parse('Даня получил свечку ТестПрепарат',med).relatedRxId,'r');assert.equal(parse('Даня получил свечку ТестПрепарат',med).canAutoRecord,true);
  for(const amount of ['','-1','1–2'])assert.equal(parse('Даня получил ТестПрепарат',{...med,amount}).canAutoRecord,false);
  assert.throws(()=>parse('Даня рвота',{kind:'unknown'}));assert.throws(()=>parse('Даня рвота',{notes:['x'.repeat(501)]}));
});

test('Контекст восстановления: только имена и названия действующих лекарств',()=>{
  const context=codexPeople({people:[{id:'d',name:'Даня',diagnosis:'private',age:6}],prescriptions:[{id:'r',personId:'d',name:'ТестПрепарат',dose:'secret dose'},{personId:'d',name:'ТестПрепарат'},{personId:'d',name:'Архив',archived:true},{personId:'other',name:'Чужое'}]});
  assert.deepEqual(context,[{id:'d',name:'Даня',displayName:'Даня',medicines:['ТестПрепарат']}]);
  assert.ok(knownMedicines.some(m=>m.name==='Парацетамол'));assert.ok(knownMedicines.every(m=>Object.keys(m).sort().join(',')==='aliases,name'));
});


test('Имя после ASR: восстановление из people с исходным фрагментом, без выдуманного пациента',()=>{
  for(const mention of ['Да нет','Да не','Доня']){const text=mention+', две минуты назад температура 38,2',d=parse(text,{personMention:mention});assert.equal(d.personId,'d');assert.equal(d.canAutoRecord,true);assert.equal(d.sourceText,text);}
  for(const change of [{personMention:''},{personMention:'Даня'},{personMention:'38,2'},{personMention:'да',personId:'missing'}])assert.equal(parse('Да нет, температура 38,2',change).canAutoRecord,false);
  assert.equal(parse('температура 38,2').canAutoRecord,false);
  assert.equal(parse('Да нет, мама, температура 38,2',{personMention:'Да нет'}).canAutoRecord,false);
  assert.equal(parse('Алиса и Даня, температура 38,2',{personMention:'Даня'}).canAutoRecord,false);
  assert.equal(parse('Да нет, температура 38,2',{personMention:'Да нет',needsReview:true,notes:['Нужно уточнить человека']}).canAutoRecord,false);
  assert.equal(parse('Да неточно, температура 38,2',{personMention:'Да нет'}).canAutoRecord,false);
});
