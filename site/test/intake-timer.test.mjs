import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeTimer,prescribedInterval,dailyIntakeProgress,manualIntakeTimers,suggestedManualInterval} from '../public/intake-timer.js';

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
  copy.model.history=[{...event},{...event,id:'second',occurredAt:new Date(start+6*3600000).toISOString()}];
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

test('Точки дня объединяют назначения одного препарата и человека, учитывают отмену и новый день',()=>{
  const rows=[0,1,2].map(i=>({...row,key:'dose-'+i,prescriptionId:i===2?'evening':'r'}));
  const copy={prescriptions:[{id:'r',personId:'p',input},{id:'evening',personId:'p',input}],model:{cards:[{id:'p',current:{rows:rows.slice(0,2)},earlier:[],later:[{rows:[rows[2],rows[0]]}]}],history:[]}};
  assert.deepEqual(dailyIntakeProgress(copy,row),{taken:0,total:3,period:'за день расписания'});
  copy.model.history=[{...event,rowKey:rows[0].key}];
  assert.equal(dailyIntakeProgress(copy,row).taken,1);
  assert.equal(dailyIntakeProgress(copy,row,[{kind:'cancel',targetId:event.id}]).taken,0);
  copy.model.history[0].status='void';
  assert.equal(dailyIntakeProgress(copy,row).taken,0);
  copy.model.history=[...rows.map((item,i)=>({...event,id:'fact-'+i,rowKey:item.key}))];
  assert.equal(dailyIntakeProgress(copy,row).taken,3);
  copy.model.history.forEach(item=>item.rowKey='previous-'+item.rowKey);
  assert.equal(dailyIntakeProgress(copy,row).taken,0);
  assert.equal(dailyIntakeProgress(copy,{...row,personId:'other'}),null);
});

test('По необходимости точки используют указанный максимум за 24 часа и сохраняют неизвестность',()=>{
  const copy={prescriptions:[{id:'r',personId:'p',input:{...input,type:'prn',maxPer24h:'3'}}],model:{cards:[{id:'p'}],history:[{...event}]}};
  assert.deepEqual(dailyIntakeProgress(copy,row,[],start),{taken:1,total:3,period:'за 24 часа'});
  assert.equal(dailyIntakeProgress(copy,row,[],start+86400000).taken,0);
  copy.model.history[0].occurredAt=null;
  assert.equal(dailyIntakeProgress(copy,row,[],start),null);
});

test('Внеплановые приёмы используют явный интервал и только факты того же человека с тем же названием',()=>{
  const manual={...event,source:'activities',status:'recorded',prescriptionId:'',name:'ТестПрепарат',input:{minHours:'4',createdAt:new Date(start).toISOString()}};
  const view={timeZone:'Europe/Chisinau',prescriptions:[],model:{date:'2026-11-18',cards:[{id:'p',name:'Тест'},{id:'other',name:'Другой'}],history:[manual]}};
  assert.equal(suggestedManualInterval(view,'p',' тестпрепарат '),4);
  assert.equal(suggestedManualInterval(view,'other','ТестПрепарат'),'');
  assert.equal(suggestedManualInterval(view,'p','Другой препарат'),'');
  const hours=n=>n*3600000;
  assert.equal(manualIntakeTimers(view,'all',start)[0].until,start+hours(4));
  const next={...manual,id:'next',input:{},occurredAt:new Date(start+hours(3)).toISOString()};
  view.model.history.push({...next,id:'unrelated',personId:'other'},next);
  assert.equal(manualIntakeTimers(view,'all',start+hours(3))[0].until,start+hours(7));
  assert.deepEqual(manualIntakeTimers(view,'other',start+hours(3)),[]);
  assert.equal(manualIntakeTimers(view,'p',start+hours(7))[0].state,'elapsed');
  next.occurredAt=null;
  assert.equal(manualIntakeTimers(view,'p',start+hours(3))[0].state,'unknown');
  next.status='void';
  assert.equal(manualIntakeTimers(view,'p',start+hours(3))[0].until,start+hours(4));
  manual.status='void';
  assert.deepEqual(manualIntakeTimers(view,'p',start+hours(3)),[]);
});

test('При известном назначении ручная запись учитывает больший интервал и максимум за 24 часа',()=>{
  const manual={...event,source:'activities',status:'recorded',prescriptionId:'',name:input.name,input:{minHours:'4'}};
  const view={timeZone:input.timeZone,prescriptions:[{id:'r',personId:'p',name:input.name,confirmed:true,startDate:'2026-11-18',input:{...input,maxPer24h:'1'}}],
    model:{date:'2026-11-18',cards:[{id:'p',name:'Тест'}],history:[manual]}};
  assert.equal(suggestedManualInterval(view,'p',input.name),12);
  const [timer]=manualIntakeTimers(view,'all',start);
  assert.equal(timer.until,start+86400000);
  assert.match(timer.text,/Достигнут максимум/);
});
