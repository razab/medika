import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assert,string,day,localParts,scheduleFor,procedureNote} from './domain.mjs';
import {parsePrescription,parsePackage,buildPrescriptionPlan,contextInput} from './prescription-plan.mjs';
import {complexText,demoContext} from './lab-fixtures.mjs';
const validId=id=>typeof id==='string'&&/^[a-f\d-]{36}$/.test(id);
export async function createPrescriptionLab(dataDir,{recognize,imageType}){
 const dir=join(dataDir,'prescription-lab');await mkdir(dir,{recursive:true,mode:0o700});let busy=false;
 const path=id=>{assert(validId(id),'Неверный ID теста',404);return join(dir,id+'.json');};
 async function read(id){try{return JSON.parse(await readFile(path(id),'utf8'));}catch(e){if(e.code==='ENOENT')assert(false,'Тест не найден',404);throw e;}}
 async function exclusive(fn){assert(!busy,'Операция с тестом уже идёт',409);busy=true;try{return await fn();}finally{busy=false;}}
 async function persist(c){const file=path(c.id);await writeFile(file+'.tmp',JSON.stringify(c),{mode:0o600});await rename(file+'.tmp',file);return view(c);}
 function view(c){const packages=Object.fromEntries(Object.entries(c.packages||{}).map(([id,p])=>[id,{...p,image:p.mime?'/api/ocr-lab/cases/'+c.id+'/package-image/'+id:''}])),plan=buildPrescriptionPlan(parsePrescription(c.editedText||c.ocr.text),c.context,c.edits),testDate=c.testDate||c.context.startDate;for(const row of plan.rows)row.preview=row.ready?scheduleFor({...row.prescription,id:row.id,personId:row.personId},testDate,plan.context.people.find(p=>p.id===row.personId)):[];return {...c,packages,testDate,image:c.mime?'/api/ocr-lab/cases/'+c.id+'/image':'',plan};}
 function bytes(raw){assert(typeof raw==='string'&&/^[A-Za-z0-9+/]+=*$/.test(raw),'Некорректное изображение');const b=Buffer.from(raw,'base64');assert(b.length>0&&b.length<=12*1024*1024,'Изображение: до 12 МБ',413);assert(imageType(b),'Нужен PNG, JPEG или WebP',415);return b;}
 return {
  demo:{text:complexText,context:demoContext},
  async list(){const records=[];for(const name of (await readdir(dir)).filter(f=>/^[a-f\d-]{36}\.json$/.test(f)).slice(0,100)){const c=JSON.parse(await readFile(join(dir,name),'utf8'));records.push({id:c.id,name:c.name,updatedAt:c.updatedAt,revision:c.revision});}return records.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
  read,view,
  async remove(id){return exclusive(async()=>{await read(id);for(const name of (await readdir(dir)).filter(f=>f.startsWith(id+'.')))await unlink(join(dir,name));return {removed:true};});},
  async create(input){return exclusive(async()=>{
    assert((await this.list()).length<100,'Сохранено 100 тестов. Удалите ненужные перед новым.',409);
    const b=input.image?bytes(input.image):null,sourceHash=createHash('sha256').update(b||string(input.text,'Текст',50000,true)).digest('hex');
    // Reuse a completed OCR result for the exact same image, including after restart.
    let ocr;for(const record of await this.list()){const old=await read(record.id);if(old.sourceHash===sourceHash){ocr=old.ocr;break;}}
    if(!ocr)ocr=b?await recognize(b):{text:string(input.text,'Текст',50000,true),lines:[],engine:'Вставленный текст'};
    const c={id:randomUUID(),synthetic:input.synthetic===true,name:string(input.name||'Выписка','Название теста',200),revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sourceHash,mime:b?imageType(b):'',ocr,editedText:ocr.reviewedText||ocr.text,context:contextInput(input.context||demoContext),edits:{},events:[],viewPhases:{},variant:1};
    if(b)await writeFile(join(dir,c.id+'.image'),b,{mode:0o600});return persist(c);
  });},
  async update(id,input){return exclusive(async()=>{const c=await read(id);assert(c.revision===input.revision,'Тест изменён в другой вкладке. Откройте его заново.',409);
    if(input.testDate!==undefined)c.testDate=day(input.testDate);
    if(input.text!==undefined)c.editedText=string(input.text,'Исправленный текст',50000,true);
    if(input.context!==undefined)c.context=contextInput(input.context);
    if(input.edits!==undefined){assert(input.edits&&typeof input.edits==='object'&&!Array.isArray(input.edits)&&JSON.stringify(input.edits).length<=200000,'Слишком много правок');c.edits=input.edits;}
    if(input.viewPhases!==undefined){assert(input.viewPhases&&typeof input.viewPhases==='object'&&!Array.isArray(input.viewPhases),'Укажите фазы просмотра');assert(Object.entries(input.viewPhases).every(([id,p])=>c.context.people.some(x=>x.id===id)&&['prevention','acute'].includes(p)),'Выберите фазу пациента');c.viewPhases=input.viewPhases;}
    if(input.variant!==undefined){assert(Number.isInteger(input.variant)&&input.variant>=1&&input.variant<=6,'Вариант от 1 до 6');c.variant=input.variant;}
    view(c);c.revision++;c.updatedAt=new Date().toISOString();return persist(c);
  });},
  async package(id,input){return exclusive(async()=>{const c=await read(id);assert(c.revision===input.revision,'Тест уже изменён',409);assert(parsePrescription(c.editedText).entries.some(e=>e.id===input.entryId),'Выберите лекарство');const b=input.image?bytes(input.image):null;
    const ocr=b?await recognize(b):{text:string(input.text,'Текст упаковки',20000,true),lines:[],engine:'Вставленный текст'},pack=parsePackage(ocr.text);
    c.packages||={};if(b)await writeFile(join(dir,id+'.'+input.entryId+'.package'),b,{mode:0o600});c.packages[input.entryId]={ocr,fields:pack,mime:b?imageType(b):'',sourceHash:createHash('sha256').update(b||ocr.text).digest('hex')};c.edits.packages||={};c.edits.packages[input.entryId]=pack;c.revision++;c.updatedAt=new Date().toISOString();return persist(c);
  });},
  async event(id,input){return exclusive(async()=>{const c=await read(id);assert(c.revision===input.revision,'Тест уже изменён',409);const plan=view(c).plan,row=plan.rows.find(r=>r.id===input.rowId);assert(row?.ready,'Этот приём пока требует проверки');assert(['taken','started','void'].includes(input.status),'Неизвестный статус');
    const date=day(input.date),person=plan.context.people.find(p=>p.id===row.personId);assert(!row.prescription.carePhase||row.prescription.carePhase===input.phase,'Приём относится к другой фазе');const slots=scheduleFor({...row.prescription,id:row.id,personId:row.personId},date,person);assert(Number.isInteger(input.slotIndex)&&slots[input.slotIndex],'Нет такого слота в эту дату');
    const key=row.id+'@'+date+'#'+input.slotIndex,old=c.events.find(e=>e.key===key&&e.status!=='void');
    if(input.status==='void'){assert(old,'Нет отметки');old.status='void';old.voidedAt=new Date().toISOString();}
    else if(old){assert(old.status==='started'&&input.status==='taken','Приём уже отмечен',409);old.status='taken';old.completedAt=new Date().toISOString();}
    else c.events.push({id:randomUUID(),key,rowId:row.id,date,slotIndex:input.slotIndex,name:row.entry.name,dose:row.entry.dose,unit:row.entry.unit,doseScope:row.entry.doseScope,personName:row.personName,note:procedureNote(row.prescription),status:input.status,occurredAt:new Date().toISOString(),phase:input.phase});
    c.revision++;c.updatedAt=new Date().toISOString();return persist(c);
  });},
  async packageImage(id,entryId){assert(/^m\d+-[a-f\d]{16}$/.test(entryId),'Некорректный ID упаковки');const c=await read(id),p=c.packages?.[entryId];assert(p?.mime,'Фото упаковки не найдено',404);return {mime:p.mime,bytes:await readFile(join(dir,id+'.'+entryId+'.package'))};},
  async image(id){const c=await read(id);assert(c.mime,'Изображения нет',404);return {mime:c.mime,bytes:await readFile(join(dir,id+'.image'))};}
 };
}
