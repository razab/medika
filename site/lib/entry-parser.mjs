import {assert,string,zone,localParts,zonedInstant,nextDay,day} from './domain.mjs';

const singles={ноль:0,нуль:0,один:1,одна:1,одну:1,одно:1,два:2,две:2,двух:2,три:3,трижды:3,четыре:4,пять:5,шесть:6,семь:7,восемь:8,девять:9,десять:10,одиннадцать:11,двенадцать:12,тринадцать:13,четырнадцать:14,пятнадцать:15,шестнадцать:16,семнадцать:17,восемнадцать:18,девятнадцать:19,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
const tens={двадцать:20,тридцать:30,сорок:40,пятьдесят:50,шестьдесят:60,семьдесят:70,восемьдесят:80,девяносто:90,twenty:20,thirty:30,forty:40,fifty:50};
const singleKeys=Object.keys(singles).sort((a,b)=>b.length-a.length).join('|'),tensKeys=Object.keys(tens).join('|');
const edge='(?<![\\p{L}\\p{N}])',end='(?![\\p{L}\\p{N}])';
const wordPattern=words=>new RegExp(edge+'(?:'+words.join('|')+')'+end,'iu');
export function spokenNumbers(text){
  return text.toLowerCase().replace(/ё/gu,'е')
    .replace(new RegExp(edge+'('+tensKeys+')(?:[\\s-]+('+singleKeys+'))?(?:\\s*(?:и|целых|point|запятая)\\s+('+singleKeys+'))?(?:\\s+десятых)?'+end,'giu'),(_,t,s,f)=>String(tens[t]+(s?singles[s]:0))+(f!==undefined?'.'+singles[f]:''))
    .replace(new RegExp(edge+'('+singleKeys+')'+end,'giu'),word=>String(singles[word]))
    .replace(/(?<!\p{L})полтаблетки(?!\p{L})/giu,'0.5 табл.').replace(/(?<!\p{L})(?:половин[ау]|half)(?!\p{L})/giu,'0.5')
    .replace(/(?<!\p{L})(?:полтора|полторы)(?!\p{L})/giu,'1.5')
    .replace(/(?<!\p{L})(?:четверть|quarter)(?!\p{L})/giu,'0.25');
}
function nameForms(p){
  const names=[...new Set([p.name,p.displayName].filter(Boolean).map(s=>s.toLowerCase().replace(/ё/gu,'е')))];
  for(const name of [...names]){
    if(/^[а-я]+а$/u.test(name))for(const suffix of ['е','у','ы','ой'])names.push(name.slice(0,-1)+suffix);
    if(/^[а-я]+я$/u.test(name))for(const suffix of ['е','ю','и','ей'])names.push(name.slice(0,-1)+suffix);
    if(name==='алиса')names.push('alice','alisa');
    if(name==='даня')names.push('danya','dania');
    if(name==='папа')names.push('dad','papa');
    if(name==='мама')names.push('mom','mum','mama');
  }
  return names.map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
}
const letters={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ы:'y',э:'e',ю:'yu',я:'ya',ь:'',ъ:''};
function phonetic(s){return s.toLowerCase().replace(/c(?=[ei])/g,'ts').replace(/c/g,'k').replace(/x/g,'ks').replace(/[а-яё]/gu,c=>letters[c]).replace(/[^a-z0-9]/g,'');}
const unitPatterns=[['свеча','свеч[а-я]*|suppositor(?:y|ies)'],['табл.','таблет[а-я]*|табл\.?|tablets?'],['капс.','капсул[а-я]*|capsules?'],['мл','мл\.?|миллилитр[а-я]*|ml'],['мкг','мкг|микрограмм[а-я]*|mcg'],['мг','мг\.?|миллиграмм[а-я]*|mg'],['г','грамм[а-я]*|grams?'],['кап.','капл[а-я]*|кап\.?|drops?'],['впрыскивание','впрыск[а-я]*|пшик[а-я]*|sprays?'],['пакет','пакет[а-я]*|sachets?']];
export function namedPeople(state,text){return state.people.filter(p=>wordPattern(nameForms(p)).test(text.toLowerCase().replace(/ё/gu,'е')));}
export function parseEntry(state,input,{now=new Date()}={}){
  const sourceText=string(input.text,'Фраза',4000,true),timeZone=zone(input.timeZone||'Europe/Chisinau'),original=sourceText.toLowerCase().replace(/ё/gu,'е');
  assert(!/[;\n]|\b(?:then)\b|(?:потом|затем|после этого)/iu.test(sourceText),'Пока записывайте по одному событию: разделите эту фразу.');
  const explicit=namedPeople(state,original);
  const selected=state.people.find(p=>p.id===input.personId),p=explicit.length===1?explicit[0]:explicit.length>1?null:selected;
  const missing=[],notes=[];if(!p)missing.push('personId');
  if(input.recordedAt!==undefined){
    assert(typeof input.recordedAt==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.recordedAt)&&Number.isFinite(Date.parse(input.recordedAt)),'Некорректное время записи');
    day(input.recordedAt.slice(0,10));assert(Date.parse(input.recordedAt)<=now.getTime()+60000,'Время записи не может быть в будущем');now=new Date(input.recordedAt);
  }
  let text=spokenNumbers(sourceText),date=localParts(now,timeZone).date,occurredAt=now.toISOString();
  text=text.replace(/пару\s+минут/giu,'2 минуты').replace(/полчаса/giu,'0.5 часа').replace(/(?<![\p{L}\d])минуту\s+назад/giu,'1 минуту назад').replace(/(?<![\p{L}\d])час\s+назад/giu,'1 час назад').replace(/\ban?\s+(minute|hour)\s+ago\b/giu,'1 $1 ago');
  const relative=text.match(/(?<![\p{L}\d.,–—-])(\d+(?:[.,]\d+)?)\s*(секунд[а-я]*|минут[а-я]*|мин\.?|час[а-я]*|seconds?|minutes?|mins?|hours?)\s*(?:назад|ago)(?!\p{L})/iu);
  const hasRelative=/назад|\bago\b/iu.test(text);
  assert(!/завтра|tomorrow|планирую/iu.test(text),'Будущее действие не записывается как факт. Используйте предписание врача.');
  if(/позавчера|day before yesterday/iu.test(text))date=nextDay(date,-2);else if(/вчера|yesterday/iu.test(text))date=nextDay(date,-1);
  const dateMatch=text.match(/(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/u);
  if(dateMatch){date=`${dateMatch[3]||date.slice(0,4)}-${dateMatch[2].padStart(2,'0')}-${dateMatch[1].padStart(2,'0')}`;text=text.replace(dateMatch[0],' ');}
  const clock=text.match(new RegExp(edge+'(?:в|at)\\s+([01]?\\d|2[0-3])(?:[:.]([0-5]\\d))?(?!\\d)(?!\\s*(?:мл|мг|ml|mg|табл|капл|свеч))','iu'))||text.match(/(?<![\d.,])([01]\d|2[0-3]):([0-5]\d)(?!\d)/u);
  if(hasRelative){
    const prefix=relative?text.slice(0,relative.index):'';
    if(!relative||dateMatch||clock||/вчера|yesterday/iu.test(text)||/\d\s*[–—-]\s*$/u.test(prefix)||/(?:час[а-я]*|hours?)\s*(?:и|and)?\s*$/iu.test(prefix)){
      occurredAt='';missing.push('occurredAt');notes.push('Не разобран промежуток времени.');
    }else{
      const factor=/^(?:сек|second)/iu.test(relative[2])?1000:/^(?:час|hour)/iu.test(relative[2])?3600000:60000;
      const elapsed=Number(relative[1].replace(',','.'))*factor;
      if(elapsed>0&&elapsed<=366*86400000)occurredAt=new Date(now.getTime()-elapsed).toISOString();
      else{occurredAt='';missing.push('occurredAt');notes.push('Проверьте промежуток времени.');}
    }
    if(relative)text=text.replace(relative[0],' ');
  }else if(clock){
    let hour=Number(clock[1]);if(/вечера|\bpm\b/iu.test(text)&&hour<12)hour+=12;
    if(/\bam\b/iu.test(text)&&hour===12)hour=0;
    try{occurredAt=zonedInstant(date,`${String(hour).padStart(2,'0')}:${clock[2]||'00'}`,timeZone);}catch{occurredAt='';missing.push('occurredAt');}
    text=text.replace(clock[0],' ');
  }else if(dateMatch||/вчера|yesterday|утром|вечером|ночью|утра|вечера|morning|evening|позавчера|завтра/iu.test(text)){
    occurredAt='';missing.push('occurredAt');notes.push('Точное время не названо.');
  }
  if(occurredAt&&Date.parse(occurredAt)>now.getTime()+60000){missing.push('occurredAt');notes.push('Это время ещё не наступило — проверьте дату.');}
  let carePhase=p?.carePhase||'';
  if(/остр[а-я]*\s+фаз[а-я]*|acute/iu.test(text))carePhase='acute';
  if(/профилактик[а-я]*|prevention/iu.test(text))carePhase='prevention';
  for(const person of explicit)text=text.replace(new RegExp(edge+'(?:'+nameForms(person).join('|')+')'+end,'giu'),' ');
  text=text.replace(/(?:профилактик[а-я]*|остр[а-я]*\s+фаз[а-я]*|acute|prevention|сейчас|сегодня|вчера|now|today|yesterday)/giu,' ').trim();
  const temp=text.match(/(?:температур[а-я]*|temperature|fever)\s*(?:(?:была|есть|высокая|is|was|high)\s*)*[,:—]?\s*([\d.,–-]+)/iu);
  const temperatureMention=/температур[а-я]*|temperature|fever/iu.test(text);
  const extraTemperature=temp&&/^\s*(?:(?:и|или|or|and|[–—-])\s*)?\d/u.test(text.slice(temp.index+temp[0].length));
  if(temp)temp[1]=temp[1].replace(/[.,]+$/u,'');
  const negated=/не\s+было|не\s+рвало|рвоты\s+нет|поноса\s+нет|без\s+(?:рвоты|поноса|диареи)|no\s+(?:vomiting|diarrhea)/iu.test(text);
  const retching=!negated&&/позыв[а-я]*\s+(?:к|на)\s+рвот[а-я]*|retch(?:ing|ed)?|dry\s+heav(?:ing|es)/iu.test(text);
  const vomiting=!negated&&!retching&&/рвот[а-я]*|вырвало|vomit(?:ing|ed)?/iu.test(text),diarrhea=!negated&&/понос[а-я]*|диаре[а-я]*|diarrh(?:ea|oea)/iu.test(text),inhalation=/ингаляц[а-я]*|inhalation|nebuliz[аa-z]*|дышал[а-я]*/iu.test(text);
  assert(!((temperatureMention?1:0)+(vomiting||retching?1:0)+(diarrhea?1:0)>1),'В этой фразе несколько событий — запишите их по отдельности.');
  let kind=temperatureMention?'temperature':retching?'retching':vomiting?'vomiting':diarrhea?'diarrhea':inhalation?'inhalation':'other';
  let name='',amount='',unit='',strength='',relatedRxId='',celsius=temp?temp[1].replace(',','.'):'';
  if(temp&&/^\d{2}-\d$/u.test(celsius)){celsius=celsius.replace('-','.');notes.push('Тире в распознавании прочитано как запятая — проверьте число.');}
  if(temp&&(extraTemperature||!/^\d{2}(?:\.\d{1,2})?$/u.test(celsius))){celsius='';missing.push('celsius');notes.push('Нужно одно точное значение температуры.');}
  if(/(?:врач\s+назначил|назначено|предписано|принимать.+раз[а-я]*\s+в\s+день|prescribed)/iu.test(text))assert(false,'Это похоже на предписание врача. Добавьте его в блоке «Врач», отдельно от фактов приёма.');
  const medicines=p?[...new Set([...state.prescriptions.filter(r=>r.personId===p.id).map(r=>r.name),...state.documents.filter(d=>d.personId===p.id&&d.sourceKind!=='household').flatMap(d=>d.suggestions.map(s=>s.name)),...(state.activities||[]).filter(r=>r.personId===p.id&&r.kind==='medication').map(r=>r.name)])]:[];
  const tokens=text.match(/[\p{L}\d-]+/gu)||[];
  const matches=medicines.filter(m=>tokens.some(t=>phonetic(t)===phonetic(m))||wordPattern([m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')]).test(text));
  const medicineVerbs='дал[аи]?|дали|принял[аи]?|выпил[аи]?|поставил[аи]?|закапал[аи]?|получил[аи]?|дали|gave|took|taken|received';
  const medicineAction=wordPattern([medicineVerbs]).test(text);
  assert(!((temperatureMention||vomiting||retching||diarrhea)&&(medicineAction||inhalation)),'В этой фразе несколько событий — запишите их по отдельности.');
  assert(matches.length<2,'Названо несколько препаратов — запишите каждый отдельно.');
  assert(!new RegExp('не\\s+(?:'+medicineVerbs+'|сделал[аи]?)'+end+'|did\\s+not\\s+(?:give|take|receive)','iu').test(text),'Отрицание не подтверждает выполненное действие. Уточните фразу.');
  if(kind==='other'&&(matches.length||medicineAction||wordPattern(['suppository','свеч[а-я]*','таблет[а-я]*']).test(text)))kind='medication';
  if(kind==='medication'||kind==='inhalation'){
    const concentration=text.match(/\d+(?:[.,]\d+)?\s*(?:мг|мкг|mg|mcg)\s*(?:\/|на)\s*(?:\d+\s*)?(?:мл|ml)/iu);if(concentration){strength=concentration[0];text=text.replace(concentration[0],' ');}
    const quantityText=text.replace(/\d+(?:[.,]\d+)?\s*[–—-]\s*\d+(?:[.,]\d+)?/gu,'?');
    const quantities=unitPatterns.flatMap(([u,pattern])=>{const match=quantityText.match(new RegExp('(?<![\\d.,–-])(\\d+(?:[.,]\\d+)?)\\s*(?:'+pattern+')'+end,'iu'));return match?[{u,match}]:[];});
    const singular=[['свеча','свечку|свечу|(?:a\\s+)?suppository'],['табл.','таблетку|(?:a\\s+)?tablet'],['капс.','капсулу|(?:a\\s+)?capsule']].find(([,pattern])=>wordPattern([pattern]).test(text));
    const q=quantities[0],counted=q&&['свеча','табл.','капс.'].includes(q.u);
    if(singular&&!counted&&!/[?\d]\s*(?:свеч|таблет|капсул)/iu.test(quantityText)&&!/\d\s*[–—-]\s*\d/u.test(text)){
      amount='1';unit=singular[0];
    }else if(q){amount=q.match[1].replace(',','.');unit=q.u;text=text.replace(q.match[0],' ');}
    if(['свеча','табл.','капс.'].includes(unit)){const s=text.match(/\d+(?:[.,]\d+)?\s*(?:мг|mg|мкг|mcg)/iu);if(s){strength=strength||s[0];text=text.replace(s[0],' ');}}
    if(matches.length===1)name=matches[0];
    else name=text.replace(new RegExp(edge+'(?:'+medicineVerbs+'|давал[аи]?|сделал[аи]?|inhalation|with|used|water|ингаляц[а-я]*|дышал[а-я]*|свеч[а-я]*|таблет[а-я]*|капсул[а-я]*|tablets?|suppositor(?:y|ies)|capsules?)'+end,'giu'),word=>/^water$/iu.test(word)?'Вода':' ').replace(/^[\s,.:—-]*(?:у|с|со|in|at|a|the|of)\s+/iu,'').replace(/\s+/gu,' ').replace(/^[\s,.:—-]+|[\s,.:—-]+$/gu,'').trim();
    if(kind==='inhalation'&&/^(?:с\s+)?вод[а-я]*$/iu.test(name))name='Вода';
    if(!name)missing.push('name');
    if(kind==='medication'&&p){const rxs=state.prescriptions.filter(r=>r.personId===p.id&&phonetic(r.name)===phonetic(name));if(rxs.length===1)relatedRxId=rxs[0].id;}
    if(!amount)notes.push('Количество не названо; оно не подставляется из назначения.');
  }else if(kind==='other'){name=text.replace(/^[\s,.:—-]+|[\s,.:—-]+$/gu,'').trim();if(name.length>200){name=name.slice(0,197)+'…';notes.push('Полная фраза сохранится в источнике записи.');}}
  if(kind==='temperature'&&!(Number(celsius)>=20&&Number(celsius)<=50)){missing.push('celsius');notes.push('Проверьте распознанное значение.');}
  if(kind==='other'&&!name)missing.push('name');
  const canAutoRecord=explicit.length===1&&!missing.length&&!notes.length&&kind!=='other'&&!/не было|нет|без\s|не получил|не принимал|такую[ -]то|какую[ -]то/iu.test(text);
  return {personId:p?.id||'',kind,name,amount,unit,strength,celsius,occurredAt,timeZone,carePhase,relatedRxId,sourceText,missing:[...new Set(missing)],notes,canAutoRecord};
}
