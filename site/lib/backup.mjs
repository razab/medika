import {writeFile,unlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assert,personInput,rxInput,temperatureInput,activityInput,day,string,positive,parseSuggestions,zone,units} from './domain.mjs';

const idOK=id=>typeof id==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(id);
const iso=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
function metadata(record){assert(idOK(record.id)&&Number.isInteger(record.version)&&record.version>=1&&iso(record.createdAt),'Повреждены идентификатор, версия или дата записи');if(record.updatedAt)assert(iso(record.updatedAt),'Повреждена дата изменения');return {id:record.id,version:record.version,createdAt:record.createdAt,...(record.updatedAt?{updatedAt:record.updatedAt}:{})};}

export async function restoreBackup(store,uploads,input,imageType){
  assert(input.format==='medika-backup'&&[1,2,3].includes(input.version),'Версия резервной копии Медики не поддерживается');
  for(const key of ['people','documents','prescriptions','events'])assert(Array.isArray(input[key])&&input[key].length<=10000,'Некорректный раздел копии: '+key);
  if(input.version>=2||input.temperatures!==undefined)assert(Array.isArray(input.temperatures)&&input.temperatures.length<=10000,'Некорректный раздел копии: temperatures');
  if(input.version>=3||input.activities!==undefined)assert(Array.isArray(input.activities)&&input.activities.length<=10000,'Некорректный раздел копии: activities');
  assert(input.images&&typeof input.images==='object'&&!Array.isArray(input.images),'Отсутствует раздел изображений');
  const data={people:[],documents:[],prescriptions:[],events:[],temperatures:[],activities:[]};
  data.people=input.people.map(p=>({...personInput(p),...metadata(p)}));
  const personIds=new Set([...store.state().people,...data.people].map(p=>p.id));
  data.temperatures=(input.temperatures||[]).map(t=>{
    const validated=temperatureInput(t);assert(personIds.has(t.personId),'Измерение ссылается на неизвестного человека');
    assert(['recorded','void'].includes(t.status),'Повреждён статус измерения');
    return {...validated,status:t.status,...(t.status==='void'?{voidReason:string(t.voidReason,'Причина отмены',1000,true)}:{}),...metadata(t)};
  });
  data.activities=(input.activities||[]).map(a=>{
    const validated=activityInput(a);assert(personIds.has(a.personId),'Событие ссылается на неизвестного человека');
    assert(['recorded','void'].includes(a.status),'Повреждён статус события');
    return {...validated,status:a.status,...(a.status==='void'?{voidReason:string(a.voidReason,'Причина отмены',1000,true)}:{}),...metadata(a)};
  });
  data.documents=input.documents.map(d=>{
    assert(personIds.has(d.personId)&&/^[a-f\d]{64}$/.test(d.hash),'Повреждён документ или связь с человеком');
    assert(['','image/png','image/jpeg','image/webp'].includes(d.mime),'Неподдерживаемый формат оригинала');
    const text=string(d.text,'Текст документа',50000);
    const lines=Array.isArray(d.lines)?d.lines:[];assert(lines.length<=10000,'Слишком много строк OCR');
    for(const l of lines)assert(typeof l.text==='string'&&l.text.length<=5000&&typeof l.confidence==='number'&&l.confidence>=0&&l.confidence<=1&&Array.isArray(l.box)&&l.box.length===4&&l.box.every(n=>typeof n==='number'&&Number.isFinite(n)),'Повреждены строки OCR');
    const extra={};if(d.sourceKind!==undefined){assert(['doctor','household','other'].includes(d.sourceKind),'Некорректный источник');extra.sourceKind=d.sourceKind;}if(d.ocrText!==undefined)extra.ocrText=string(d.ocrText,'Исходный OCR',50000);if(d.reviewNotes!==undefined)extra.reviewNotes=string(d.reviewNotes,'Заметки сверки',12000);
    return {personId:d.personId,hash:d.hash,name:string(d.name,'Название документа',250,true),mime:d.mime,text,lines,suggestions:d.sourceKind==='household'?[]:parseSuggestions(text),...extra,...metadata(d)};
  });
  const docs=new Map([...store.state().documents,...data.documents].map(d=>[d.id,d]));
  data.prescriptions=input.prescriptions.map(r=>{
    assert(personIds.has(r.personId),'Назначение ссылается на неизвестного человека');
    const validated=rxInput({...r,times:Array.isArray(r.times)?r.times.join(', '):r.times,ingredients:Array.isArray(r.ingredients)?r.ingredients.join(' + '):r.ingredients});
    if(validated.documentId)assert(docs.get(validated.documentId)?.personId===r.personId,'Оригинал назначения принадлежит другому человеку');
    return {...validated,personId:r.personId,archived:r.archived===true,...metadata(r)};
  });
  const rxs=new Map([...store.state().prescriptions,...data.prescriptions].map(r=>[r.id,r]));
  data.events=input.events.map(r=>{
    const rx=rxs.get(r.rxId);assert(rx&&rx.personId===r.personId,'Повреждена связь приёма и назначения');
    assert(typeof r.key==='string'&&r.key.startsWith(r.rxId+'@')&&r.key.length<180,'Повреждён ключ события');
    assert(['taken','skipped','deferred','void'].includes(r.status)&&iso(r.occurredAt),'Повреждены статус или время приёма');
    assert(units.includes(r.unit)&&Array.isArray(r.ingredients)&&r.ingredients.every(x=>typeof x==='string'&&x.length<=600),'Повреждены единицы или состав');
    if(r.scheduledAt)assert(iso(r.scheduledAt)&&r.key===r.rxId+'@'+r.scheduledAt,'Повреждено плановое время');
    if(!r.scheduledAt)assert(idOK(r.key.split('@prn-')[1]),'Повреждён ключ приёма по необходимости');
    if(r.doseScope)assert(['total','each-nostril'].includes(r.doseScope),'Некорректная область дозы');
    return {...(r.scheduledAt?{scheduledAt:r.scheduledAt}:{}),...(r.time?{time:string(r.time,'Часы',5)}:{}),...(r.doseScope?{doseScope:r.doseScope}:{}),...(r.purpose!==undefined?{purpose:string(r.purpose,'Зачем назначено',1000)}:{}),rxId:r.rxId,personId:r.personId,key:r.key,status:r.status,occurredAt:r.occurredAt,date:day(r.date),timeZone:zone(r.timeZone),name:string(r.name,'Название',200,true),dose:positive(r.dose,'Плановая доза'),unit:r.unit,ingredients:r.ingredients,conditions:string(r.conditions,'Условия',2000),actualDose:positive(r.actualDose,'Фактическая доза'),note:string(r.note,'Примечание',2000),author:string(r.author,'Автор',100),...(r.voidReason?{voidReason:string(r.voidReason,'Причина',1000)}:{}),...metadata(r)};
  });
  const planned=[];
  for(const [table,records]of Object.entries(data)){
    const ids=new Set();
    for(const record of records){assert(!ids.has(record.id),'Повторный идентификатор в копии');ids.add(record.id);let existing=store.get(table,record.id);if(table==='documents'&&existing)existing={...existing,suggestions:existing.sourceKind==='household'?[]:parseSuggestions(existing.text)};assert(!existing||canonical(existing)===canonical(record),'В копии другая версия существующей записи. Ничего не восстановлено.',409);if(!existing)planned.push([table,record]);}
  }
  const keys=new Set(store.state().events.map(r=>r.key));for(const [table,r]of planned)if(table==='events'){assert(!keys.has(r.key),'Дублируется отметка приёма');keys.add(r.key);}
  const clientKeys=new Set(store.state().activities.map(r=>r.clientKey));for(const [table,r]of planned)if(table==='activities'){assert(!clientKeys.has(r.clientKey),'Дублируется ключ события');clientKeys.add(r.clientKey);}
  assert(!input.audit||Array.isArray(input.audit)&&input.audit.length<=50000,'Повреждён журнал изменений');
  const audit=input.audit||[];for(const a of audit)assert(idOK(a.id)&&iso(a.createdAt)&&typeof a.action==='string'&&JSON.stringify(a).length<=200000,'Повреждена запись журнала изменений');
  const images=[];
  for(const doc of data.documents)if(doc.mime){
    const image=input.images[doc.id];assert(typeof image==='string'&&/^[A-Za-z0-9+/]+=*$/.test(image),'Отсутствует оригинал выписки');
    const bytes=Buffer.from(image,'base64');assert(bytes.length<=12*1024*1024&&imageType(bytes)===doc.mime&&createHash('sha256').update(bytes).digest('hex')===doc.hash,'Повреждено изображение выписки');images.push([doc.id,bytes]);
  }
  const written=[];
  try{
    for(const [id,bytes]of images){
      try{const old=await readFile(join(uploads,id));assert(old.equals(bytes),'Оригинал выписки отличается от копии',409);}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(join(uploads,id),bytes,{flag:'wx',mode:0o600});written.push(id);}
    }
    store.transaction(()=>{
      for(const[table,r]of planned){const cols=table==='documents'?['person_id','hash']:table==='activities'?['person_id','client_key']:['prescriptions','temperatures'].includes(table)?['person_id']:table==='events'?['rx_id','event_key']:[];const values=table==='documents'?[r.personId,r.hash]:table==='activities'?[r.personId,r.clientKey]:['prescriptions','temperatures'].includes(table)?[r.personId]:table==='events'?[r.rxId,r.key]:[];store.db.prepare(`INSERT INTO ${table}(id,data${cols.map(c=>','+c).join('')}) VALUES(${['?','?',...values.map(()=>'?')].join(',')})`).run(r.id,JSON.stringify(r),...values);}
      for(const a of audit)store.db.prepare('INSERT OR IGNORE INTO audit VALUES(?,?,?)').run(a.id,a.createdAt,JSON.stringify(a));
    });
  }catch(error){for(const id of written)await unlink(join(uploads,id)).catch(()=>{});throw error;}
  return {inserted:planned.length};
}
