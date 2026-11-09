import {prescriptionSummary,prescriptionSequence} from './prescription-summary.js';

export const phaseLabel=phase=>({acute:'Острая фаза',prevention:'Поддерживающая'}[phase]||'Фаза не указана');
export function shortDose(row){
  if(!row.dose)return 'Доза не указана';
  const n=Number(row.dose),last=n%10,unit=row.unit==='впрыскивание'?(Number.isInteger(n)&&last===1&&n%100!==11?'пшик':Number.isInteger(n)&&last>=2&&last<=4&&!(n%100>=12&&n%100<=14)?'пшика':'пшиков'):row.unit||'';
  return [String(row.dose).replace('.',','),unit].filter(Boolean).join(' ');
}
const localDate=(instant,zone)=>new Date(instant).toLocaleDateString('sv-SE',{timeZone:zone});
const localTime=(instant,zone)=>new Date(instant).toLocaleTimeString('ru-RU',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
const clock=value=>/^\d{2}:\d{2}$/.test(value||'')?value:'';

export function familyPreview(state,schedule,{date,now=new Date(),timeZone='Europe/Chisinau'}={}){
  date??=localDate(now,timeZone);
  const order=['Алиса','Даня','Мама','Папа'],rank=p=>{const n=order.indexOf(p.displayName||p.name);return n<0?order.length:n;};
  const prescriptions=new Map((state.prescriptions||[]).map(r=>[r.id,r])),people=[...(state.people||[])].sort((a,b)=>rank(a)-rank(b));
  const cards=people.map((person,index)=>{
    const groups=new Map();
    for(const item of schedule.items||[]){
      const rx=prescriptions.get(item.rxId);
      if(item.personId!==person.id||item.historical||!rx?.confirmed||rx.personId!==person.id||rx.archived||rx.startDate>date||rx.endDate&&rx.endDate<date||rx.carePhase&&rx.carePhase!==(person.carePhase||'prevention'))continue;
      const anchor=item.anchor||'clock',key=anchor==='clock'?'clock':anchor,label=anchor==='clock'?'Отдельные приёмы':anchor==='unassigned'?'Нужно привязать приём':item.label||'Приём без названия';
      if(!groups.has(key))groups.set(key,{key,label,time:'',rows:[]});
      const group=groups.get(key),at=clock(item.displayTime)||clock(item.time);
      if(at&&(!group.time||at<group.time))group.time=at;
      const event=item.event,shown=event?.status==='taken'?{...item,name:event.name,dose:event.actualDose||event.dose,unit:event.unit,doseScope:event.doseScope}:item;
      const full=prescriptionSummary(shown),sequence=prescriptionSequence(rx),exact=anchor==='clock'&&at?`Назначенное время: ${at}`:'';
      group.rows.push({key:item.key,name:shown.name,dose:shortDose(shown),taken:event?.status==='taken',status:event?({taken:`Принято в ${localTime(event.occurredAt,event.timeZone||timeZone)}`,skipped:'Пропущено',deferred:'Отложено'}[event.status]||''):'',after:sequence||(rx.type==='interval'&&rx.intervalHours?`Каждые ${rx.intervalHours} ч`:''),instruction:[full.dose,item.relation,exact,rx.strength,rx.sourceText,rx.conditions,rx.purpose].filter(Boolean).join('\n')});
    }
    const ordered=[...groups.values()].sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
    const nowTime=localTime(now,timeZone);let currentIndex=0;
    // Keep the last started slot visible until the next one begins; no catch-up recommendation.
    for(let i=0;i<ordered.length;i++)if(ordered[i].time&&ordered[i].time<=nowTime)currentIndex=i;
    const prn=(schedule.prn||[]).filter(r=>r.personId===person.id&&r.confirmed&&!r.archived).map(r=>({name:r.name,dose:shortDose(r),instruction:[prescriptionSummary(r).dose,r.sourceText,r.conditions].filter(Boolean).join('\n')}));
    return {id:person.id,name:person.displayName||person.name,phase:phaseLabel(person.carePhase),color:['blue','peach','mint','lilac'][index%4],current:ordered[currentIndex]||null,later:ordered.slice(currentIndex+1),earlier:ordered.slice(0,currentIndex),prn};
  });
  const records=[...(state.activities||[]),...(state.temperatures||[]).map(r=>({...r,kind:'temperature'})),...(state.events||[]).map(r=>({...r,kind:'medication',amount:r.actualDose||r.dose}))];
  const history=records.filter(r=>r.status!=='void'&&Number.isFinite(Date.parse(r.occurredAt))&&Date.parse(r.occurredAt)<=Number(now)&&localDate(r.occurredAt,r.timeZone||timeZone)===date).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)).map(r=>({personId:r.personId,time:localTime(r.occurredAt,r.timeZone||timeZone),name:r.kind==='temperature'?Number(r.celsius).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:2})+' °C':r.kind==='inhalation'?['Ингаляция',r.name].filter(Boolean).join(' · '):r.name||({diarrhea:'Диарея',vomiting:'Рвота',retching:'Позывы к рвоте',inhalation:'Ингаляция',other:'Событие'}[r.kind]||'Событие'),detail:[r.amount,r.unit,r.status==='skipped'?'Пропущено':r.status==='deferred'?'Отложено':r.kind==='medication'?'принято':''].filter(Boolean).join(' ')}));
  return {date,cards,history};
}
