export const anchors={breakfast:'Завтрак',lunch:'Обед',dinner:'Ужин',secondDinner:'Второй ужин',bedtime:'Перед сном'};
export const relations={'':'К точке дня',before:'До еды',with:'Во время еды',after:'После еды'};
export const dayType=date=>[0,6].includes(new Date(date+'T12:00:00Z').getUTCDay())?'weekend':'weekday';
export const emptyRoutine=()=>Object.fromEntries(['weekday','weekend'].map(d=>[d,{times:{},intakes:['breakfast','lunch','dinner']}]));
export function slotDetails(slot,profile){
  const index=['first','second','third'].indexOf(slot.anchor);
  const anchor=index<0?slot.anchor:profile.intakes[index];
  const raw=anchor==='clock'?slot.time:profile.times[anchor]||'';
  const shifted=raw&&Number(slot.offsetMinutes)?raw.split('–').map(t=>{
    const [h,m]=t.split(':').map(Number),minutes=h*60+m+Number(slot.offsetMinutes);
    return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  }).join('–'):raw;
  return {anchor:anchor||'unassigned',label:anchors[anchor]||(anchor==='clock'?'Точное время':'Не привязан'),displayTime:shifted||'',relation:slot.relation?relations[slot.relation]:'',offsetMinutes:Number(slot.offsetMinutes)||0};
}
