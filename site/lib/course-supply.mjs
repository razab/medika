import {localParts,nextDay,scheduleFor,zonedInstant} from './domain.mjs';
import {medicineKey} from './medicines.mjs';

export function courseSupply(state,{date,now}){
  const groups=new Map();
  const events=new Map(state.events.filter(e=>e.status!=='void').map(e=>[e.key,e]));
  for(const rx of state.prescriptions){
    const person=state.people.find(p=>p.id===rx.personId);
    if(!person||rx.archived||!rx.confirmed||rx.carePhase&&rx.carePhase!==(person.carePhase||'prevention')||rx.endDate&&rx.endDate<date)continue;
    const medicine=state.medicines.find(m=>m.id===rx.medicineId);
    const form=rx.medicineForm||medicine?.medicineForm||rx.form;
    const key=medicineKey({...rx,medicineForm:form})+'|'+rx.unit+(!rx.medicineId&&(!form||!rx.strength)?'|'+rx.id:'');
    if(!groups.has(key))groups.set(key,{key,name:rx.name,strength:rx.strength||'',unit:rx.unit,total:0,people:[],incomplete:[]});
    const group=groups.get(key);
    const end=rx.type==='once'?rx.startDate:rx.endDate;
    if(rx.type==='prn'||!end){group.incomplete.push({personId:person.id,name:person.displayName||person.name,reason:rx.type==='prn'?'По необходимости':'Не указана дата окончания'});continue;}
    const from=rx.startDate>date?rx.startDate:date;
    if(end<from)continue;
    let count;
    if(rx.type==='interval'){
      const first=Math.max(Date.parse(rx.anchor),Date.parse(zonedInstant(from,'00:00',rx.timeZone)));
      const last=Date.parse(zonedInstant(nextDay(end),'00:00',rx.timeZone));
      const interval=rx.intervalHours*3600000;
      count=Math.max(0,Math.ceil((last-Date.parse(rx.anchor))/interval)-Math.ceil((first-Date.parse(rx.anchor))/interval));
    }else{
      const days=Math.round((Date.parse(end)-Date.parse(from))/86400000)+1;
      const start=new Date(from+'T12:00:00Z').getUTCDay();
      const scheduledDays=rx.weekdays?rx.weekdays.reduce((sum,d)=>sum+Math.floor(days/7)+((d-start+7)%7<days%7?1:0),0):days;
      count=scheduledDays*(rx.type==='routine'?rx.routineSlots.length:rx.times.length);
    }
    const dose=Number(rx.dose)*(rx.doseScope==='each-nostril'?2:1);
    let amount=count*dose;
    // Deduct recorded/skipped occurrences and elapsed clock times, including preserved legacy keys.
    const dates=new Set([from]);
    for(const event of state.events)if(event.rxId===rx.id&&event.date>=from&&event.date<=end)dates.add(event.date);
    const today=localParts(now,rx.timeZone).date;
    if(from<=today&&today<=end)dates.add(today);
    for(const day of dates)for(const item of scheduleFor(rx,day,person)){
      const event=events.get(item.key)||events.get(item.legacyKey);
      if(event&&['taken','skipped'].includes(event.status)||item.scheduledAt&&Date.parse(item.scheduledAt)<Number(now)&&!event){count--;amount-=dose;}
    }
    amount=Math.max(0,Number(amount.toFixed(6)));
    const own=group.people.find(p=>p.personId===person.id);
    if(own){own.amount=Number((own.amount+amount).toFixed(6));own.occurrences+=Math.max(0,count);}
    else group.people.push({personId:person.id,name:person.displayName||person.name,amount,occurrences:Math.max(0,count)});
    group.total=Number((group.total+amount).toFixed(6));
  }
  return [...groups.values()].filter(g=>g.total>0||g.incomplete.length).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
