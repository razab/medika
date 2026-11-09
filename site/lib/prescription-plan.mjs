import {createHash} from 'node:crypto';
import {assert,string,day,courseEnd,rxInput,personInput,zone} from './domain.mjs';
import {profileSlots} from '../public/routine.js';
import {inferMedicineForm,allowedMedicineUnits} from '../public/medicine-forms.js';
export const parserVersion='prescription-plan-1';
export const pulmicortSource={url:'https://www.medicines.org.uk/emc/product/880/smpc',title:'Pulmicort Respules 0.5 mg · AstraZeneca UK · SmPC',country:'UK',checkedAt:'2026-11-09'};
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
const clean=s=>s.replace(/^\s*(?:\d+[.)]\s*|[•–-]\s*)/u,'').trim();
const num=s=>s==='½'||s==='1/2'?'0.5':s==='¼'||s==='1/4'?'0.25':s.replace(',','.');
const unitOf=s=>/^табл/iu.test(s)?'табл.':/^капс/iu.test(s)?'капс.':/^впрыск/iu.test(s)?'впрыскивание':/^кап/iu.test(s)?'кап.':/^свеч/iu.test(s)?'свеча':/^доз/iu.test(s)?'доза':/^пакет/iu.test(s)?'пакет':s.toLowerCase();
const dosePattern=/(?:^|\s)(?:по\s+)(½|¼|1\/2|1\/4|\d+(?:[.,]\d+)?)\s*(?:(?:жевательн\S*|цел\S*)\s+)?(табл[а-я.]*|капс[а-я.]*|мл|мг|мкг|кап[а-я.]*|впрыскиван[а-я]*|свеч[а-я]*|доз[а-я]*|пакет[а-я]*)/iu;
const strengthPattern=/\d+(?:[.,]\d+)?\s*(?:мг|мкг|mg)(?:\s*\+\s*\d+(?:[.,]\d+)?\s*(?:мг|мкг|mg))*(?:\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:мл|ml|доза))?/iu;
function medicationStart(line){
  const text=clean(line);return !/^(?:по |в |с |для |через |затем |смеш|развод|ингаляция |производитель|срок |не |до |после |во время |курс|или$)/iu.test(text)&&(/^[\p{L}\d-]+[^\n]*(?:\d+\s*(?:мг|мкг|мл)|по\s+(?:\d|½|¼))/iu.test(text));
}
function parseBlock(block,index){
  const sourceText=block.text,content=sourceText.replace(/\n/g,' '),str=strengthPattern.exec(content),dose=dosePattern.exec(content.replace(/полтаблетки/giu,'0,5 таблетки'));
  const beforeDose=content.slice(0,dose?.index??content.length),nameEnd=Math.min(str?.index??Infinity,beforeDose.search(/[—–]|\s+-\s/u)<0?Infinity:beforeDose.search(/[—–]|\s+-\s/u));
  const name=clean(content.slice(0,Number.isFinite(nameEnd)?nameEnd:beforeDose.length)).split(',')[0].replace(/\s+(?:таблетки|капли|спрей|сироп|раствор|суспензия).*$/iu,'').trim();
  const once=/однократно|разово/iu.test(content)&&!/в день|в сутки|ежедневно/iu.test(content);
  const namedFrequency=/утром и вечером|дважды|два раза/iu.test(content)?2:/трижды|три раза/iu.test(content)?3:/один раз|вечером|перед сном|утром/iu.test(content)||once?1:null;
  const count=content.match(/(?<![\d–-])(\d{1,2})\s*раз(?:а)?\s*в\s*(?:день|сутки)/iu),rangedFrequency=/\d+\s*[–-]\s*\d+\s*раз/iu.test(content);
  const clocks=[...content.matchAll(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g)].map(m=>m[1].padStart(2,'0')+':'+m[2]);
  const duration=content.match(/(?:в течение|курс(?:ом)?(?:\s+не более)?|на)\s*(\d+)\s*(дн[еяй]*|недел[яьи]*|месяц[а-я]*)/iu),durationRange=/(?:в течение|курс(?:ом)?|на)\s*\d+\s*[–-]\s*\d+\s*(?:дн|недел|месяц)/iu.test(content);
  const interval=content.match(/каждые\s+(\d+)\s*(?:час|ч\b)/iu),minAge=content.match(/(?:только\s+)?(?:с|от)\s*(\d+)\s*лет|(?:нельзя|противопоказан\S*)\s*(?:детям\s*)?до\s*(\d+)\s*лет/iu);
  const rangeDose=/по\s*\d+(?:[.,]\d+)?\s*[–-]\s*\d/iu.test(content),medicineForm=inferMedicineForm(content);
  const relation=/перед едой|до еды/iu.test(content)?'before':/после еды/iu.test(content)?'after':/во время еды|с едой/iu.test(content)?'with':'';
  const mixing=content.match(/(?:смешать|развести|добавить|смешивать)[^.\n]*(?:[.,]\d[^.\n]*)?/iu)?.[0]||'';
  const durationMinutes=content.match(/(?:ингаляци\S*|процедур\S*)\s*(?:делать|длится|по|в течение)?\s*(\d+)\s*мин/iu)?.[1]||'';
  const issues=[];if(once&&(interval||duration&&Number(duration[1])>1))issues.push('Разовый приём и длительный курс противоречат друг другу');if(clocks.length&&(count||namedFrequency)&&!interval&&clocks.length!==Number(count?.[1]||namedFrequency))issues.push('Кратность и часы расходятся: уточните расписание');if(block.incomplete)issues.push('Незавершённая альтернатива: проверьте оригинал');if(/не принимать|не применять|не давать|отменить|приостановить/iu.test(content))issues.push('В тексте отмена или отрицание: требуется сверка');if([...content.matchAll(new RegExp(dosePattern.source,'giu'))].length>1)issues.push('В строке несколько доз: уточните для пациента');if(!dose||rangeDose)issues.push('Уточнить разовую дозу');if(!count&&!namedFrequency&&!clocks.length&&!interval&&!/по необходимости/iu.test(content))issues.push('Не найдена кратность');if(rangedFrequency)issues.push('Уточнить кратность: в тексте диапазон');if(durationRange)issues.push('Уточнить длительность: в тексте диапазон');if(block.sequence&&block.sequenceKind!=='relative')issues.push('Последующий этап: укажите дату начала');if(/мг\s*\/\s*кг|мг на кг/iu.test(content))issues.push('Доза по весу требует отдельной проверки');
  return {id:'m'+index+'-'+hash(sourceText),name,sourceText:block.quote||sourceText,carePhase:block.phase,phaseSource:block.phaseSource||'',origin:block.origin||'doctor',choiceGroup:block.choiceGroup||'',sequence:block.sequence||'',sequenceKind:block.sequenceKind||'',medicineForm,strength:str?.[0]||'',dose:dose&&!rangeDose?num(dose[1]):'',unit:dose?unitOf(dose[2]):'',frequency:!rangedFrequency?(count?Number(count[1]):clocks.length||namedFrequency||null):null,times:clocks,once,...(/суббот[а-я]* и воскресень[а-я]*/iu.test(content)?{weekdays:[0,6]}:{}),intervalHours:interval?Number(interval[1]):null,relation,duration:duration&&!durationRange?{count:Number(duration[1]),unit:/^дн/iu.test(duration[2])?'days':/^недел/iu.test(duration[2])?'weeks':'months'}:null,durationText:durationRange?content.match(/\d+\s*[–-]\s*\d+\s*(?:дн[еяй]*|недел[яьи]*|месяц[а-я]*)/iu)?.[0]||'':'',doseScope:/в каждую ноздрю/iu.test(content)?'each-nostril':'total',minAgeYears:minAge?Number(minAge[1]||minAge[2]):null,ageSource:minAge?'Выписка: '+minAge[0]:'',mixing,durationMinutes,conditions:[block.phaseSource,block.sequence,mixing,durationMinutes?'Ингаляция '+durationMinutes+' мин':'',content.match(/Через\s+\d+\s*[–-]\s*\d+\s+минут[^.]+/iu)?.[0]].filter(Boolean).join('. '),issues};
}
export function parsePrescription(text){
  text=string(text,'Выписка',50000,true);const blocks=[],unparsed=[];let phase='prevention',phaseSource='',current=null,nextAlternative=false,sequence='',sequenceKind='stage',origin='doctor';
  const flush=()=>{if(current){blocks.push(current);current=null;}};
  for(const original of text.split(/\n+/)){
    const line=original.trim();if(!line)continue;
    if(/^Дополнительная запись пользователя/iu.test(line)){flush();origin='manual';continue;}
    if(/^(?:поддерживающ|профилакти|базисн|неостр|в неостр|вне острой|при отсутствии обострения|вне обострения)/iu.test(line)){flush();phase='prevention';phaseSource=line;continue;}
    if(/^(?:остр\S*\s+(?:фаза|состояние|лечение)|при (?:обострении|появлении|ухудшении))/iu.test(line)){flush();phase='acute';phaseSource=line;continue;}
    if(/^(?:в обоих состояниях|общая схема|для обеих фаз)/iu.test(line)){flush();phase='';phaseSource=line;continue;}
    if(/^(?:или|либо)\s*[:.]?$/iu.test(line)){flush();nextAlternative=true;continue;}
    if(/^(?:или|либо)\s+/iu.test(line)){flush();nextAlternative=true;}
    if(/^Через\s+\d+.*после/iu.test(line)){flush();sequence=line;sequenceKind='relative';if(!/использовать\s+\S/iu.test(line))continue;}
    if(/^затем\s+/iu.test(line)){flush();sequence=line;sequenceKind='stage';}
    if(/неразборчив|\[не\s*ясно\]/iu.test(line)){flush();unparsed.push(line);continue;}
    const lineClean=clean(line.replace(/^(?:или|либо)\s+/iu,'').replace(/^(?:Затем\s+)?продолжить лечение препаратом\s+/iu,'').replace(/^Через\s+\d+.*?использовать\s+/iu,''));
    if(medicationStart(lineClean)){
      flush();current={text:lineClean,phase,phaseSource,sequence,sequenceKind,origin};sequence='';sequenceKind='stage';
      if(nextAlternative&&blocks.length&&blocks.at(-1).phase===phase){const previous=blocks.at(-1),group=previous.choiceGroup||'choice-'+blocks.length;previous.choiceGroup=group;current.choiceGroup=group;nextAlternative=false;}
      const alternatives=lineClean.split(/\s+(?:или|либо)\s+/iu);
      if(alternatives.length>1&&alternatives.slice(1).every(medicationStart)){const group='choice-inline-'+blocks.length,shared=alternatives.at(-1).match(/[—–]\s*по\s+.+$/iu)?.[0]||'',base={...current};for(let i=0;i<alternatives.length;i++){if(i)flush();const part=alternatives[i];current={...base,text:part+(!dosePattern.test(part)&&shared?' '+shared:''),quote:lineClean,choiceGroup:group};}}
    }else if(current)current.text+='\n'+line;
    else if(!/медикаментозн|лечени[ея]:?$|рекомендации|следующая лечебная тактика/iu.test(line)){if(/через\s+\d/iu.test(line))sequence=line;else unparsed.push(line);}
  }
  flush();if(nextAlternative){unparsed.push('ИЛИ: не найдена вторая альтернатива');if(blocks.length)blocks.at(-1).incomplete=true;}
  const entries=blocks.map(parseBlock).filter(e=>e.name);assert(entries.length<=100,'Не более 100 назначений в одном тесте');return {parserVersion,text,entries,unparsed,choiceGroups:[...new Set(entries.map(e=>e.choiceGroup).filter(Boolean))].map(id=>({id,entryIds:entries.filter(e=>e.choiceGroup===id).map(e=>e.id)}))};
}
export function parsePackage(text){
  text=string(text,'Текст упаковки',20000,true);const minAge=text.match(/(?:с|от)\s*(\d+)\s*лет|противопоказан\S*\s*(?:детям\s*)?до\s*(\d+)\s*лет/iu);
  return {text,name:text.split('\n').find(s=>s.trim())?.trim()||'',medicineForm:inferMedicineForm(text),strength:text.match(strengthPattern)?.[0]||'',manufacturer:text.match(/(?:производитель|manufacturer)\s*[:：]?\s*([^\n]+)/iu)?.[1]?.trim()||'',minAgeYears:minAge?Number(minAge[1]||minAge[2]):null,ageSource:minAge?'Упаковка: '+minAge[0]:''};
}
export const availableSlots=profileSlots;

function selectSlots(entry,slots){
  if(entry.times.length)return entry.times.map(time=>({id:'clock',label:'Точное время',time}));
  if(/перед сном/iu.test(entry.sourceText))return slots.filter(s=>s.id==='bedtime').slice(0,1);
  if(/вечером/iu.test(entry.sourceText)&&entry.frequency===1)return slots.filter(s=>s.id==='dinner').slice(0,1);
  const n=entry.frequency;if(!n||n>slots.length)return [];
  if(n===2){const preferred=['breakfast','dinner'].map(id=>slots.find(s=>s.id===id));if(preferred.every(Boolean))return preferred;return [slots[0],slots.at(-1)];}
  if(n===3){const preferred=['breakfast','lunch','dinner'].map(id=>slots.find(s=>s.id===id));if(preferred.every(Boolean))return preferred;}
  return slots.slice(0,n);
}
export function contextInput(input){
  assert(input&&Array.isArray(input.people)&&input.people.length>0&&input.people.length<=12,'Укажите пациентов');
  const people=input.people.map(p=>{assert(typeof p.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(p.id),'Некорректный ID пациента');return {...personInput(p),id:p.id,selected:p.selected!==false,sourceVersion:p.sourceVersion==null?null:Number(p.sourceVersion)};});
  for(const p of people)if(!p.daySlots)p.daySlots={weekday:profileSlots(p,'weekday'),weekend:profileSlots(p,'weekend')};
  assert(new Set(people.map(p=>p.id)).size===people.length,'Пациент повторяется');
  return {people,startDate:day(input.startDate),timeZone:zone(input.timeZone||'Europe/Chisinau')};
}
export function buildPrescriptionPlan(parsed,rawContext,edits={}){
  const context=contextInput(rawContext),rows=[];const choices=edits.choices||{};
  for(const person of context.people.filter(p=>p.selected))for(const original of parsed.entries){
    const edit={...(edits.entries?.[original.id]||{}),...(edits.people?.[person.id]?.[original.id]||{})};
    const entry={...original,...Object.fromEntries(Object.entries(edit).filter(([k])=>['name','dose','unit','strength','medicineForm','frequency','mixing','durationMinutes','excluded','startDate','endDate','carePhase'].includes(k)))};
    const selected=!entry.excluded&&(!entry.choiceGroup||choices[entry.choiceGroup]===entry.id);
    const blockers=[...entry.issues],checks=[];
    if(entry.dose&&Number(entry.dose)>0){const i=blockers.indexOf('Уточнить разовую дозу');if(i>=0)blockers.splice(i,1);}
    if(edit.dose){for(const text of ['В строке несколько доз: уточните для пациента','Доза по весу требует отдельной проверки']){const i=blockers.indexOf(text);if(i>=0)blockers.splice(i,1);}}
    if(edit.frequency&&Number(edit.frequency)===entry.times.length){const i=blockers.indexOf('Кратность и часы расходятся: уточните расписание');if(i>=0)blockers.splice(i,1);}
    if(edit.frequency){for(const text of ['Не найдена кратность','Уточнить кратность: в тексте диапазон']){const i=blockers.indexOf(text);if(i>=0)blockers.splice(i,1);}}
    if(edit.startDate&&entry.sequence){const i=blockers.indexOf('Последующий этап: укажите дату начала');if(i>=0)blockers.splice(i,1);}
    if(edit.endDate){const i=blockers.indexOf('Уточнить длительность: в тексте диапазон');if(i>=0)blockers.splice(i,1);}
    const pack=edits.packages?.[original.id];
    if(pack?.medicineForm&&entry.medicineForm&&pack.medicineForm!==entry.medicineForm)blockers.push('Форма на упаковке отличается: проверьте форму препарата');
    if(pack&&entry.strength&&pack.strength&&entry.strength.replace(/\s/g,'').replace(/,/g,'.')!==pack.strength.replace(/\s/g,'').replace(/,/g,'.')&&!edit.strength)blockers.push('Концентрация упаковки отличается: проверьте поле «На упаковке»');
    if(pack){if(!entry.strength)entry.strength=string(pack.strength,'Концентрация',150);if(!entry.medicineForm)entry.medicineForm=string(pack.medicineForm,'Форма',40);}
    const minAge=entry.minAgeYears??pack?.minAgeYears,age=person.birthday?(new Date(context.startDate)-new Date(person.birthday))/31557600000:person.ageYears;
    if(minAge!=null){if(age==null)blockers.push('Укажите возраст для проверки ограничения '+minAge+'+');else if(age<minAge)blockers.push('Возраст '+age+': в источнике ограничение '+minAge+'+');checks.push({type:'age',text:entry.ageSource||pack?.ageSource||'Упаковка',minAgeYears:minAge});}else checks.push({type:'unknown',text:'Возрастные ограничения не проверены: нужна инструкция точной упаковки'});
    if(/мг\s*\/\s*кг|мг на кг/iu.test(entry.sourceText)&&!person.weight)blockers.push('Для дозы по весу укажите вес');
    if(!entry.medicineForm)blockers.push('Уточнить форму препарата');
    if(!allowedMedicineUnits(entry.medicineForm).includes(entry.unit))blockers.push('Единица дозы не подходит для формы');
    if(entry.medicineForm==='inhalation'){
      if(!entry.strength)blockers.push('Для ингаляции укажите концентрацию с упаковки');
      if(/вод[аыой]+/iu.test(entry.mixing))blockers.push('В смеси указана вода: уточните растворитель по назначению и инструкции');
      if(/пульмикорт|pulmicort/iu.test(entry.name))checks.push({type:'reference',text:'Pulmicort Respules: ингаляционная суспензия; инструкция UK описывает смешивание с NaCl 0,9%. Объём и минуты не подставляются.',source:pulmicortSource});
    }
    let prescription=null;const weekday=selectSlots(entry,availableSlots(person,'weekday')),weekend=selectSlots(entry,availableSlots(person,'weekend'));
    if(entry.intervalHours){if(!entry.times.length)blockers.push('Интервальный курс: укажите первый приём');}
    else if(!/по необходимости/iu.test(entry.sourceText)&&(!weekday.length||weekday.length!==(entry.times.length||Number(entry.frequency))||!weekend.length||weekend.length!==weekday.length))blockers.push('Недостаточно доступных слотов: настройте распорядок пациента один раз');
    if(!entry.dose)blockers.push('Не указана разовая доза');
    if(selected&&!blockers.length){
      try{
        const startDate=edit.startDate||context.startDate,endDate=edit.endDate||(entry.once?startDate:entry.duration?courseEnd(startDate,entry.duration.count,entry.duration.unit):'');
        const type=/по необходимости/iu.test(entry.sourceText)?'prn':entry.intervalHours?'interval':entry.times.length?(entry.once?'once':'daily'):'routine';
        prescription=rxInput({name:entry.name,medicineForm:entry.medicineForm,form:entry.medicineForm,dose:entry.dose,unit:entry.unit,strength:entry.strength,startDate,endDate,type,times:entry.times.join(', '),intervalHours:entry.intervalHours,anchorTime:entry.times[0],routineSlots:weekday.map((s,i)=>({anchor:'slot:'+s.id,weekendAnchor:'slot:'+weekend[i].id,relation:entry.relation})),...(entry.weekdays?{weekdays:entry.weekdays}:{}),carePhase:entry.carePhase,conditions:[...new Set([entry.phaseSource,entry.sequence,entry.mixing,entry.durationMinutes?'Ингаляция '+entry.durationMinutes+' мин':'',entry.sourceText.match(/Через\s+\d+\s*[–-]\s*\d+\s+минут[^.]+/iu)?.[0]].filter(Boolean))].join('. '),sourceText:entry.sourceText,doseScope:entry.doseScope,timeZone:context.timeZone,confirmed:true,ingredients:'',regimen:{mixing:entry.mixing,durationMinutes:entry.durationMinutes,choiceGroup:entry.choiceGroup,origin:entry.origin,...(minAge!=null?{minAgeYears:minAge}:{}),ageSource:entry.ageSource||pack?.ageSource||'',packageText:pack?.text?.slice(0,2000)||'',manufacturer:pack?.manufacturer||'',parserVersion}});
      }catch(error){blockers.push(error.message);}
    }
    rows.push({id:person.id+'|'+entry.id,personId:person.id,personName:person.name,entryId:entry.id,entry,selected,choiceRequired:!!entry.choiceGroup&&!parsed.choiceGroups.find(g=>g.id===entry.choiceGroup)?.entryIds.includes(choices[entry.choiceGroup]),blockers:[...new Set(blockers)],checks,weekday,weekend,prescription,ready:selected&&!!prescription&&!blockers.length});
  }
  return {parserVersion,context,parsed,rows,ready:rows.filter(r=>r.ready).length,blocked:rows.filter(r=>r.selected&&r.blockers.length).length,unresolvedChoices:parsed.choiceGroups.filter(g=>!g.entryIds.includes(choices[g.id])&&g.entryIds.some(id=>!edits.entries?.[id]?.excluded)).length};
}
