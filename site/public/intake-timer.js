const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/ё/g,'е').trim();

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
  const interval=prescribedInterval(rx);
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
  const lookback=Math.max(interval?.hours||0,max?24:0);
  const since=new Date(now-lookback*3600000).toLocaleDateString('sv-SE',{timeZone:rx.timeZone});
  if(history.some(event=>!event.occurredAt&&event.date>=since))return {state:'unknown',text:'Есть приём с неизвестным временем · проверьте историю'};
  const events=history.filter(event=>Date.parse(event.occurredAt)<=now).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
  const latest=events[0];
  if(!latest)return null;
  let until=interval?Date.parse(latest.occurredAt)+interval.hours*3600000:0;
  const recent=events.filter(event=>Date.parse(event.occurredAt)>now-86400000);
  const atLimit=max>0&&recent.length>=max;
  if(!interval&&!atLimit)return {state:'count',text:`${recent.length} из ${max} приёмов за 24 ч · интервал не указан`};
  if(atLimit)until=Math.max(until,Date.parse(recent[Math.ceil(max)-1].occurredAt)+86400000);
  const time=new Date(until).toLocaleTimeString('ru-RU',{timeZone:rx.timeZone,hour:'2-digit',minute:'2-digit'});
  const seconds=Math.max(0,Math.ceil((until-now)/1000));
  const clock=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
  return {state:until>now?'waiting':'elapsed',until,eventId:latest.id,
    text:until>now?`${atLimit?'Достигнут максимум за 24 ч':'До следующего приёма'} · ${clock} · не ранее ${time}`:
      'Указанный интервал прошёл',
    detail:interval?`Интервал ${interval.hours} ч от фактического приёма`:max?`Не более ${max} приёмов за 24 ч`:''};
}
