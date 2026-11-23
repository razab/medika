import {rowEvent} from './design-study/a1-events.js';

const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/ё/g,'е').trim();

export function dailyIntakeProgress(snapshot,row,actions=[],now=Date.now()){
  const rx=snapshot.prescriptions.find(r=>r.id===row.prescriptionId)?.input;
  const person=snapshot.model.cards.find(p=>p.id===row.personId);
  if(!rx||!person)return null;
  const identity=input=>[input.medicineId||input.name,input.medicineForm||input.form,input.strength,input.unit].map(normalize).join('|');
  const ids=new Set(snapshot.prescriptions.filter(p=>p.personId===row.personId&&p.input&&identity(p.input)===identity(rx)).map(p=>p.id));
  if(rx.type==='prn'){
    const total=Number(rx.maxPer24h);
    if(!Number.isInteger(total)||total<1||total>100)return null;
    const cancelled=new Set(actions.filter(a=>a.kind==='cancel').map(a=>a.targetId));
    const events=snapshot.model.history.filter(event=>event.personId===row.personId&&ids.has(event.prescriptionId)&&
      ['taken','recorded'].includes(event.status)&&!cancelled.has(event.id));
    const today=new Date(now-86400000).toLocaleDateString('sv-SE',{timeZone:rx.timeZone});
    if(events.some(event=>!event.occurredAt&&event.date>=today))return null;
    const taken=events.filter(event=>Date.parse(event.occurredAt)>now-86400000&&Date.parse(event.occurredAt)<=now).length;
    return {total,taken,period:'за 24 часа'};
  }
  const groups=[...(person.current?[person.current]:[]),...person.earlier,...person.later];
  const rows=[...new Map(groups.flatMap(group=>group.rows).filter(item=>ids.has(item.prescriptionId)).map(item=>[item.key,item])).values()];
  if(!rows.length)return null;
  return {total:rows.length,taken:rows.filter(item=>rowEvent(snapshot,actions,{...item,personId:row.personId})).length,period:'за день расписания'};
}

export function prescribedInterval(rx){
  if(Number(rx.minHours)>0)return {hours:Number(rx.minHours),source:'Назначение'};
  if(rx.type==='interval'&&Number(rx.intervalHours)>0)return {hours:Number(rx.intervalHours),source:'Расписание'};
  const text=[rx.sourceText,rx.conditions].filter(Boolean).join(' ');
  const match=text.match(/(?:каждые|интервал(?:ом)?\s+(?:не\s+менее\s+)?|не\s+ранее\s+чем\s+через)\s*(\d+(?:[.,]\d+)?)\s*(?:час(?:а|ов)?|ч\.?|hours?)(?=\s|[,.]|$)/iu);
  const hours=match&&Number(match[1].replace(',','.'));
  if(hours>0&&hours<=720)return {hours,source:'Текст назначения'};
  return null;
}

export function intakeTimer(snapshot,row,now=Date.now()){
  const rx=snapshot.prescriptions.find(r=>r.id===row.prescriptionId)?.input;
  if(!rx)return null;
  const interval=Math.max(prescribedInterval(rx)?.hours||0,manualHours(snapshot,row.personId,rx.name));
  const max=Number(rx.maxPer24h)||0;
  if(!interval&&!max)return null;
  const prescriptions=snapshot.prescriptions.filter(p=>p.personId===row.personId);
  const ids=new Set(prescriptions.filter(p=>p.id===row.prescriptionId||
    rx.medicineId&&p.input?.medicineId===rx.medicineId||normalize(p.name)===normalize(rx.name)||
    rx.ingredients?.some(a=>p.input?.ingredients?.some(b=>normalize(a)===normalize(b)))).map(p=>p.id));
  const names=new Set(prescriptions.filter(p=>ids.has(p.id)).map(p=>normalize(p.name)));
  const history=snapshot.model.history.filter(event=>event.personId===row.personId&&
    ['taken','recorded'].includes(event.status)&&['medication','inhalation'].includes(event.kind)&&
    (ids.has(event.prescriptionId)||names.has(normalize(event.input?.name||event.name))));
  return countdown(history,{hours:interval,max,timeZone:rx.timeZone},now);
}

const medicineName=event=>normalize(event.input?.name||event.name);
const recordedMedication=event=>event.kind==='medication'&&['taken','recorded'].includes(event.status);

function manualHours(snapshot,personId,name,history=snapshot.model.history){
  const key=normalize(name);
  let latestRule, latestAt=-Infinity;
  for(const event of history){
    if(event.source!=='activities'||event.personId!==personId||!recordedMedication(event)||medicineName(event)!==key)continue;
    const hours=Number(event.input?.minHours);
    const at=Date.parse(event.input?.createdAt||event.occurredAt);
    if(hours>=0.01&&hours<=720&&at>latestAt){latestRule=hours;latestAt=at;}
  }
  return latestRule||0;
}

function prescriptionRule(snapshot,personId,name){
  const date=snapshot.model.date;
  const phase=snapshot.model.cards.find(person=>person.id===personId)?.phaseKey;
  const matches=snapshot.prescriptions.filter(rx=>rx.input&&rx.personId===personId&&rx.confirmed&&normalize(rx.name)===normalize(name)&&
    (!rx.phase||rx.phase===phase)&&rx.startDate<=date&&(!rx.endDate||rx.endDate>=date));
  const limits=matches.map(rx=>Number(rx.input.maxPer24h)).filter(max=>Number.isInteger(max)&&max>0);
  return {hours:Math.max(0,...matches.map(rx=>prescribedInterval(rx.input)?.hours||0)),max:limits.length?Math.min(...limits):0};
}

export function suggestedManualInterval(snapshot,personId,name){
  if(!personId||!normalize(name))return '';
  return Math.max(manualHours(snapshot,personId,name),prescriptionRule(snapshot,personId,name).hours)||'';
}

export function manualIntakeTimers(snapshot,selected,now=Date.now()){
  const groups=new Map();
  const people=new Map(snapshot.model.cards.map(person=>[person.id,person.name]));
  for(const event of snapshot.model.history){
    if(!recordedMedication(event)||!people.has(event.personId)||selected!=='all'&&event.personId!==selected)continue;
    const key=JSON.stringify([event.personId,medicineName(event)]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(event);
  }
  const timers=[];
  for(const history of groups.values()){
    const manual=history.find(event=>event.source==='activities');
    if(!manual)continue;
    const person=manual.personId,name=manual.input?.name||manual.name;
    const preset=prescriptionRule(snapshot,person,name);
    const hours=Math.max(manualHours(snapshot,person,name,history),preset.hours);
    if(!hours&&!preset.max)continue;
    const timer=countdown(history,{hours,max:preset.max,timeZone:snapshot.timeZone},now,true);
    if(timer&&(timer.state!=='elapsed'||timer.until>now-86400000))timers.push({...timer,person:people.get(person),name});
  }
  return timers;
}

function countdown(history,{hours,max,timeZone},now,manual=false){
  const lookback=Math.max(hours,max?24:0);
  const since=new Date(now-lookback*3600000).toLocaleDateString('sv-SE',{timeZone});
  if(history.some(event=>!event.occurredAt&&event.date>=since))return {state:'unknown',text:'Есть приём с неизвестным временем · проверьте историю'};
  const events=history.map(event=>({id:event.id,time:Date.parse(event.occurredAt)})).filter(event=>event.time<=now).sort((a,b)=>b.time-a.time);
  const latest=events[0];
  if(!latest)return null;
  let until=hours?latest.time+hours*3600000:0;
  const recent=events.filter(event=>event.time>now-86400000);
  const atLimit=max>0&&recent.length>=max;
  if(!hours&&!atLimit)return {state:'count',text:`${recent.length} из ${max} приёмов за 24 ч · интервал не указан`};
  if(atLimit)until=Math.max(until,recent[Math.ceil(max)-1].time+86400000);
  const seconds=Math.max(0,Math.ceil((until-now)/1000));
  const clock=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
  const end=new Date(manual?Math.ceil(until/60000)*60000:until);
  const time=end.toLocaleTimeString('ru-RU',{timeZone,hour:'2-digit',minute:'2-digit'});
  const endDay=end.toLocaleDateString('sv-SE',{timeZone});
  const nowDay=new Date(now).toLocaleDateString('sv-SE',{timeZone});
  const date=manual&&endDay!==nowDay?end.toLocaleDateString('ru-RU',{timeZone,day:'numeric',month:'long'})+' ':'';
  return {state:until>now?'waiting':'elapsed',until,eventId:latest.id,
    text:until>now?`${atLimit?'Достигнут максимум за 24 ч':manual?'До конца интервала':'До следующего приёма'} · ${clock} · ${manual?'до':'не ранее'} ${date}${time}`:
      'Указанный интервал прошёл',
    detail:hours?`Интервал ${hours.toLocaleString('ru-RU')} ч от фактического приёма`:max?`Не более ${max} приёмов за 24 ч`:''};
}
