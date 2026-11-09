export const anchors={breakfast:'Завтрак',lunch:'Обед',dinner:'Ужин',secondDinner:'Второй ужин',bedtime:'Перед сном'};
export const relations={'':'Не указано',before:'До еды',with:'Во время еды',after:'После еды'};
export const dayType=date=>[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay())?'weekend':'weekday';
export const emptyRoutine=()=>Object.fromEntries(['weekday','weekend'].map(d=>[d,{times:{},intakes:['breakfast','lunch','dinner']}]));
export function slotDetails(slot,profile,daySlots=[]){
  if(slot.anchor.startsWith('slot:')){const available=daySlots.find(s=>s.id===slot.anchor.slice(5));return {anchor:available?.id||'unassigned',label:available?.label||'Слот недоступен',displayTime:available?.time||'',relation:slot.relation?relations[slot.relation]:''};}
  const index=['first','second','third'].indexOf(slot.anchor);
  const anchor=index<0?slot.anchor:profile.intakes[index];
  const available=daySlots.find(s=>s.id===anchor),resolved=daySlots.length&&anchor!=='clock'&&!available?'':anchor;
  const raw=anchor==='clock'?slot.time:daySlots.length?available?.time||'':profile.times[anchor]||'';
  return {anchor:resolved||'unassigned',label:anchors[resolved]||(anchor==='clock'?'Точное время':'Не привязан'),displayTime:raw||'',relation:slot.relation?relations[slot.relation]:''};
}
export function profileSlots(person,kind){
  if(person.daySlots)return person.daySlots[kind];
  const p=(person.routine||emptyRoutine())[kind],order=Object.keys(anchors).filter(a=>(p.times[a]||p.intakes.includes(a))&&!(a==='lunch'&&p.intakes[1]==='dinner'));
  return order.map(id=>({id,label:anchors[id]||id,time:/^\d{2}:\d{2}$/.test(p.times[id]||'')?p.times[id]:''}));
}

export function nextDose(items,date,nowDate,nowTime){const pending=items.filter(x=>!x.record);return (date===nowDate?pending.find(x=>x.slot.time&&x.slot.time>=nowTime):null)||pending[0]||items[0];}
