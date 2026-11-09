const timesOf=r=>Array.isArray(r.times)?r.times:String(r.times||'').split(/[,;\s]+/).filter(t=>/^\d{2}:\d{2}$/.test(t));
const plural=(n,forms)=>forms[Number.isInteger(Number(n))?(Number(n)%100>=11&&Number(n)%100<=14?2:Number(n)%10===1?0:Number(n)%10>=2&&Number(n)%10<=4?1:2):1];
export const prescriptionSequence=r=>String(r.sourceText||'').replace(/\s+/g,' ').match(/Через\s+\d+(?:\s*[–-]\s*\d+)?\s+минут\s+после\s+применения\s+[^\s,.;]+/iu)?.[0]?.replace(/\s+минут\s+/iu,' мин ')?.replace(/после применения/iu,'после')||'';
export function prescriptionSummary(r){
  const times=timesOf(r),source=String(r.sourceText||'').replace(/\s+/g,' ');
  const stated=source.match(/(?:не\s+более\s+|не\s+чаще\s+|до\s+)?\d+(?:\s*[–-]\s*\d+)?\s*раз(?:а)?\s*в\s*(?:день|сутки|неделю)/iu)?.[0]||'';
  const frequency=r.type==='prn'?'По необходимости':r.type==='once'?'Однократно':r.type==='interval'&&r.intervalHours?`Каждые ${r.intervalHours} ч`:r.type==='routine'&&r.routineSlots?.length?`${r.routineSlots.length} ${plural(r.routineSlots.length,['раз','раза','раз'])} в день`:r.type==='daily'&&times.length?`${times.length} ${plural(times.length,['раз','раза','раз'])} в день`:stated||'Частота не указана';
  const unit=r.unit==='впрыскивание'?plural(r.dose,['впрыскивание','впрыскивания','впрыскиваний']):r.unit||'';
  const dose=r.dose?[String(r.dose).replace('.',','),unit,r.doseScope==='each-nostril'?'в каждую ноздрю':''].filter(Boolean).join(' '):'Доза не указана';
  const sequence=prescriptionSequence(r);
  const weekdays=Array.isArray(r.weekdays)&&r.weekdays.length<7?r.weekdays.map(d=>['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d]).join(', '):'';
  return {dose,frequency,details:[times.join(' · '),weekdays,sequence,!times.length&&/вечером/iu.test(source)?'Вечером':'',!times.length&&/перед сном/iu.test(source)?'Перед сном':''].filter(Boolean).join(' · ')};
}
