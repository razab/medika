export const anchors={breakfast:'Завтрак',lunch:'Обед',dinner:'Ужин',secondDinner:'Второй ужин',bedtime:'Перед сном'};
export const relations={'':'Не указано',before:'До еды',with:'Во время еды',after:'После еды'};
export const dayType=date=>[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay())?'weekend':'weekday';
export const emptyRoutine=()=>Object.fromEntries(['weekday','weekend'].map(d=>[d,{times:{},intakes:['breakfast','lunch','dinner']}]));
export function slotDetails(slot,profile){
  const index=['first','second','third'].indexOf(slot.anchor);
  const anchor=index<0?slot.anchor:profile.intakes[index];
  const raw=anchor==='clock'?slot.time:profile.times[anchor]||'';
  return {anchor:anchor||'unassigned',label:anchors[anchor]||(anchor==='clock'?'Точное время':'Не привязан'),displayTime:raw||'',relation:slot.relation?relations[slot.relation]:''};
}
