import {familyPreview} from '../public/family-preview-model.js';
import {createHash} from 'node:crypto';

// Only display data crosses into the sandbox; clinical identifiers and write metadata do not.
export function designSnapshot(state,schedule,{date,now,copiedAt=new Date(),timeZone='Europe/Chisinau'}){
  const model=familyPreview(state,schedule,{date,now,timeZone}),ids=new Map(model.cards.map((p,i)=>[p.id,'demo-person-'+(i+1)]));let dose=0;
  const row=r=>({key:'demo-dose-'+(++dose),name:r.name,dose:r.dose,taken:Boolean(r.taken),status:r.status||'',after:r.after||'',fields:r.fields,info:r.info});
  const group=g=>({label:g.label,rows:g.rows.map(row)});
  const copy={date:model.date,cards:model.cards.map(p=>({id:ids.get(p.id),name:p.name,phase:p.phase,color:p.color,current:p.current?group(p.current):null,later:p.later.map(group),earlier:p.earlier.map(group),prn:p.prn.map(row)})),history:model.history.map(r=>({personId:ids.get(r.personId)||'',time:r.time,name:r.name,detail:r.detail}))};
  const revision=createHash('sha256').update(JSON.stringify(copy)+copiedAt.toISOString()).digest('hex').slice(0,20);
  return {version:1,revision,copiedAt:copiedAt.toISOString(),contextAt:now.toISOString(),timeZone,model:copy};
}
