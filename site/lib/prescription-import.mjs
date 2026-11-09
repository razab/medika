import {medicinePhotoKey} from '../public/medicine-images.js';
import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assert,newId,personInput} from './domain.mjs';
export async function applyPrescriptionPlan(store,uploads,lab,id,input){
 assert(input.confirmed===true,'Сверьте общий план с выпиской и подтвердите перенос');const c=await lab.read(id);assert(!c.synthetic,'Это синтетический тест. Он не переносится в рабочий журнал.');const view=lab.view(c),plan=view.plan;
 assert(plan.ready>0&&!plan.blocked&&!plan.unresolvedChoices,'В плане остались вопросы: исправьте их или исключите соответствующие строки');
 const state=store.state(),rows=plan.rows.filter(r=>r.ready).map(r=>{
  const importKey=[c.sourceHash,r.personId,r.entryId,r.prescription.startDate].join(':'),importFingerprint=createHash('sha256').update(JSON.stringify({rx:r.prescription,slots:plan.context.people.find(p=>p.id===r.personId).daySlots})).digest('hex');
  const old=state.prescriptions.find(x=>x.importKey===importKey);assert(!old||old.importFingerprint===importFingerprint,'Этот курс уже импортирован с другими полями. Измените существующее назначение.',409);return {...r,importKey,importFingerprint,old};
 });
 if(rows.every(r=>r.old))return {duplicate:true,prescriptions:rows.map(r=>r.old),inserted:0};
 assert(!rows.some(r=>r.old),'Часть выбранного плана уже перенесена. Откройте сохранённые курсы.',409);
 for(const row of rows){const rx=row.prescription,overlap=state.prescriptions.find(old=>!old.archived&&old.personId===row.personId&&medicinePhotoKey(old.name)===medicinePhotoKey(rx.name)&&(!old.carePhase||!rx.carePhase||old.carePhase===rx.carePhase)&&old.startDate<=(rx.endDate||'2200-12-31')&&rx.startDate<=(old.endDate||'2200-12-31'));assert(!overlap,'У '+row.personName+' уже есть пересекающийся курс '+rx.name+'. Сверьте его в Медике и исключите повтор из этого плана.',409);}
 const people=plan.context.people.filter(p=>p.selected).map(p=>{const old=store.get('people',p.id);assert(old,'Для рабочего переноса выберите существующих пациентов');assert(p.sourceVersion===old.version,'Профиль пациента изменился. Обновите контекст семьи.',409);return {old,p};});
 const documents=[],files=[];
 try{
  for(const {p}of people){let d=state.documents.find(d=>d.personId===p.id&&d.hash===c.sourceHash);if(!d){d={id:newId(),personId:p.id,hash:c.sourceHash,name:c.name,mime:c.mime,text:c.editedText,ocrText:c.ocr.text,lines:c.ocr.lines||[],sourceKind:'doctor',reviewNotes:'Групповая сверка '+plan.parserVersion,planVersion:plan.parserVersion,planCaseId:c.id,suggestions:plan.parsed.entries};if(c.mime){await writeFile(join(uploads,d.id),(await lab.image(c.id)).bytes,{mode:0o600});files.push(d.id);}}documents.push(d);}
  return store.transaction(()=>{
   for(const {p,old}of people)store.update('people',p.id,personInput({...old,name:p.name,...(p.name!==old.name?{displayName:p.name}:{}),weight:p.weight,daySlots:p.daySlots,...(p.ageYears!=null?{ageYears:p.ageYears,ageAsOf:p.ageAsOf}:{}),carePhase:old.carePhase||'prevention'}),old.version);
   for(const doc of documents)if(!store.get('documents',doc.id))store.insert('documents',doc);
   const prescriptions=rows.map(r=>store.insert('prescriptions',{...r.prescription,personId:r.personId,documentId:documents.find(d=>d.personId===r.personId).id,importKey:r.importKey,importFingerprint:r.importFingerprint,archived:false}));return {inserted:prescriptions.length,prescriptions,duplicate:false};
  });
 }catch(error){for(const id of files)await unlink(join(uploads,id)).catch(()=>{});throw error;}
}
