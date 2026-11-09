export const allRows=snapshot=>{const rows=snapshot.model.cards.flatMap(p=>[...(p.current?.rows||[]),...p.later.flatMap(g=>g.rows),...p.earlier.flatMap(g=>g.rows),...p.prn].map(row=>({...row,personId:p.id}))),ids=new Set((snapshot.plans||[]).map(r=>r.prescriptionId));return [...(snapshot.plans||[]),...rows.filter(r=>!ids.has(r.prescriptionId))];};
export function activeEvents(snapshot,actions){const cancelled=new Set(actions.filter(a=>a.kind==='cancel').map(a=>a.targetId));return [...snapshot.model.history,...actions.filter(a=>a.kind!=='cancel')].filter(a=>!cancelled.has(a.id));}
export function rowEvent(snapshot,actions,row){
  const active=activeEvents(snapshot,actions),record=active.findLast(a=>a.rowKey===row.key);if(record)return record;
  if(row.taken){const original=snapshot.model.history.find(a=>a.prescriptionId===row.prescriptionId&&row.takenAt&&a.occurredAt===row.takenAt),id=original?.id||'base:'+row.key;if(!actions.some(a=>a.kind==='cancel'&&a.targetId===id))return {...original,id,personId:row.personId,kind:'medication',rowKey:row.key,prescriptionId:row.prescriptionId,occurredAt:row.takenAt||null,name:row.name,detail:original?.detail||row.dose};}
  return null;
}
export function dependencyStatus(snapshot,actions,row){
  if(!row.dependency)return '';
  const previous=allRows(snapshot).find(r=>r.personId===row.personId&&r.prescriptionId===row.dependency.prescriptionId&&(row.slotIndex!==null?r.slotIndex===row.slotIndex:r.slotLabel===row.slotLabel));
  const event=previous&&rowEvent(snapshot,actions,previous);if(!event)return 'Нет записи первого приёма';if(!event.occurredAt)return 'Время первого приёма неизвестно';
  const elapsed=Math.floor((Date.parse(snapshot.contextAt)-Date.parse(event.occurredAt))/60000),{minMinutes:min,maxMinutes:max}=row.dependency;
  if(elapsed<min)return `После первого приёма прошло ${Math.max(0,elapsed)} мин · интервал ещё не наступил`;
  if(elapsed<=max)return `После первого приёма прошло ${elapsed} мин · интервал ${min}–${max} мин`;
  return `После первого приёма прошло ${elapsed} мин · указанный интервал ${min}–${max} мин`;
}
export function courseWarnings(rx,date){const warnings=[];if(rx.startDate>date)warnings.push(`Начнётся ${rx.startDate.split('-').reverse().join('.')}`);const days=rx.startDate&&rx.endDate?(Date.parse(rx.endDate)-Date.parse(rx.startDate))/86400000+1:null;if(days&&rx.maxDays&&days>rx.maxDays)warnings.push(`Даты дают ${days} дней; в записи врача — ${rx.durationText}. Сверьте курс.`);if(rx.missingThird)warnings.push('Третий личный слот не настроен');return warnings;}
export function localInstant(date,time,zone){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Укажите дату и время');
  const wanted=Date.parse(`${date}T${time}:00Z`);if(!Number.isFinite(wanted)||new Date(wanted).toISOString().slice(0,10)!==date)throw Error('Укажите дату и время');let instant=wanted;
  for(let i=0;i<3;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);if(represented===wanted)return new Date(instant).toISOString();instant+=wanted-represented;}
  throw Error('Такого местного времени нет; укажите другое');
}
