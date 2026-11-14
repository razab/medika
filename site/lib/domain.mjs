import {assertContract} from './pilot-contracts.mjs';
import {medicineForms,allowedMedicineUnits} from '../public/medicine-forms.js';
import { randomUUID } from 'node:crypto';
import {anchors,dailyRoutine,profileSlots,slotDetails} from '../public/routine.js';

export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const assert = (condition, message, status = 400) => { if (!condition) throw new InputError(message, status); };
export function string(value, label, max = 500, required = false) {
  assert(typeof value === 'string' || value == null, `${label}: ожидается текст`);
  const s = (value ?? '').trim();
  assert(s.length <= max && (!required || s.length), `${label}: заполните поле (до ${max} символов)`);
  return s;
}
export function day(value) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')), 'Некорректная дата');
  assert(new Date(value + 'T12:00:00Z').toISOString().slice(0,10)===value,'Несуществующая дата');
  assert(value >= '1900-01-01' && value <= '2200-12-31', 'Дата вне диапазона 1900–2200');
  return value;
}
export function nextDay(value, offset = 1) { const d = new Date(day(value) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); }
export function zone(value = 'Europe/Chisinau') {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); } catch { throw new InputError('Неизвестный часовой пояс'); }
  return value;
}
export function localParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(new Date(instant));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function zonedInstant(date, time, timeZone) {
  day(date); zone(timeZone);
  assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(time), 'Время должно быть в формате ЧЧ:ММ');
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(guess, timeZone);
    const delta = target - Date.parse(`${p.date}T${p.time}:00Z`);
    if (!delta) break;
    guess += delta;
  }
  const candidates = [guess - 3600000, guess, guess + 3600000].filter(t => { const p = localParts(t, timeZone); return p.date === date && p.time === time; });
  assert(candidates.length, `Время ${time} не существует ${date} в ${timeZone} из-за перевода часов. Уточните время.`);
  // The earlier occurrence is explicit and deterministic on the autumn clock change.
  return new Date(Math.min(...candidates)).toISOString();
}
export function positive(value, label, optional = false) {
  if (optional && (value === '' || value == null)) return null;
  assert(typeof value === 'string' || typeof value === 'number', `${label}: укажите число`);
  const s = String(value).replace(',', '.');
  assert(/^\d+(\.\d{1,6})?$/.test(s) && Number(s) > 0 && Number(s) <= 1000000, `${label}: требуется положительное число`);
  return s;
}
export function phaseInput(value){assert(['','prevention','acute'].includes(value),'Выберите контекст предписания');return value;}
export function entryContext(input){
  const result={};
  if(input.carePhase!==undefined)result.carePhase=phaseInput(input.carePhase);
  if(input.sourceText!==undefined)result.sourceText=string(input.sourceText,'Исходная фраза',4000);
  if(input.relatedRxId!==undefined)result.relatedRxId=string(input.relatedRxId,'Связь с назначением',80);
  return result;
}
export function personInput(input) {
  const birthday = input.birthday ? day(input.birthday) : '';
  assert(!birthday || birthday <= new Date().toISOString().slice(0, 10), 'Дата рождения не может быть в будущем');
  const age={};if(input.ageYears!==''&&input.ageYears!=null){assert(Number.isInteger(Number(input.ageYears))&&Number(input.ageYears)>=0&&Number(input.ageYears)<=130,'Возраст: целое число от 0 до 130');age.ageYears=Number(input.ageYears);age.ageAsOf=day(input.ageAsOf||new Date().toISOString().slice(0,10));}
  return { name: string(input.name, 'Имя', 100, true), birthday, weight: positive(input.weight, 'Вес', true), allergies: string(input.allergies, 'Аллергии', 1000), notes: string(input.notes, 'Примечания', 3000), color: ['mint','blue','peach','lilac'].includes(input.color) ? input.color : 'mint',...age,...(input.carePhase!==undefined?{carePhase:phaseInput(input.carePhase)}:{}),...(input.displayName!==undefined?{displayName:string(input.displayName,'Имя на семейной доске',100)}:{}),...(input.routine!==undefined?{routine:routineInput(input.routine)}:{}),...(input.daySlots!==undefined?{daySlots:daySlotsInput(input.daySlots)}:{}) };
}
function clock(value){return typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);}
export function routineInput(input){
  assert(input&&typeof input==='object','Укажите распорядок');
  return Object.fromEntries(['weekday','weekend'].map(d=>{
    const p=input[d];assert(p&&typeof p==='object'&&p.times&&typeof p.times==='object','Укажите распорядок');
    const times={};for(const a of Object.keys(anchors)){
      const value=string(p.times[a],'Время '+anchors[a],11).replace(/-/g,'–');
      const parts=value.split('–');assert(!value||parts.length<=2&&parts.every(clock)&&(parts.length===1||parts[0]<parts[1]),'Время: ЧЧ:ММ или ЧЧ:ММ–ЧЧ:ММ');
      if(value)times[a]=value;
    }
    assert(Array.isArray(p.intakes)&&p.intakes.length===3&&p.intakes.every(a=>typeof a==='string'&&(a===''||Object.hasOwn(anchors,a))),'Выберите три привязки приёмов');
    const assigned=p.intakes.filter(Boolean);assert(new Set(assigned).size===assigned.length,'Для разных приёмов выберите разные точки дня');
    return [d,{times,intakes:[...p.intakes]}];
  }));
}
export function daySlotsInput(input){
  assert(input&&typeof input==='object','Укажите доступные слоты');
  return Object.fromEntries(['weekday','weekend'].map(kind=>{
    const slots=input[kind];assert(Array.isArray(slots)&&slots.length>=1&&slots.length<=12,'От 1 до 12 доступных слотов');
    const result=slots.map(s=>{assert(s&&typeof s.id==='string'&&/^[a-z][a-zA-Z0-9-]{0,39}$/.test(s.id),'Некорректный ID слота');const time=string(s.time,'Время слота',5);assert(!time||clock(time),'Время слота: ЧЧ:ММ');return {id:s.id,label:string(s.label,'Название слота',60,true),time};});
    assert(new Set(result.map(s=>s.id)).size===result.length,'Слот повторяется');return [kind,result];
  }));
}
const validAnchor=a=>['','first','second','third','clock',...Object.keys(anchors)].includes(a)||typeof a==='string'&&/^slot:[a-z][a-zA-Z0-9-]{0,39}$/.test(a);
function slotsInput(input){
  assert(Array.isArray(input)&&input.length>=1&&input.length<=12,'Укажите от 1 до 12 приёмов');
  return input.map(s=>{
    assert(s&&validAnchor(s.anchor),'Выберите точку дня');
    assert(['','before','with','after'].includes(s.relation||''),'Укажите связь с едой');
    assert(!s.relation||!['bedtime','clock',''].includes(s.anchor),'Связь с едой доступна для приёмов пищи');
    assert(s.anchor!=='clock'||clock(s.time),'Укажите точное время');
    if(s.weekendAnchor!==undefined)assert(validAnchor(s.weekendAnchor),'Выберите слот выходного дня');
    return {anchor:s.anchor,relation:s.relation||'',...(s.anchor==='clock'?{time:s.time}:{}),...(s.weekendAnchor!==undefined?{weekendAnchor:s.weekendAnchor}:{})};
  });
}
export function validateRoutineBinding(rx,person){
  if(rx.type!=='routine')return;
  for(const slot of rx.routineSlots){
    const details=slotDetails(slot,dailyRoutine(person),person?.daySlots?profileSlots(person):[]);
    assert(!slot.relation||details.anchor!=='bedtime','Перед сном — отдельная точка, без привязки к еде');
  }
}
export function procedureNote(rx){const r=rx.regimen;return r?[r.mixing?'Схема смеси: '+r.mixing:'',r.durationMinutes?'По назначению: '+r.durationMinutes+' мин':''].filter(Boolean).join('\n'):'';}
export const units = ['табл.', 'капс.', 'мл', 'мг', 'мкг', 'г', 'кап.', 'доза', 'впрыскивание', 'пакет', 'свеча', 'нанесение'];
export function occurrenceInput(input){
  assert(input&&typeof input==='object'&&!Array.isArray(input),'Ожидается запись события');
  if(input.timeUnknown===true){const timeZone=zone(input.timeZone||'Europe/Chisinau'),knownDate=day(input.knownDate);assert(input.occurredAt===null||input.occurredAt==='','Не указывайте часы для неизвестного времени');assert(knownDate<=localParts(new Date(),timeZone).date,'Событие не может быть в будущем');return {personId:string(input.personId,'Человек',80,true),occurredAt:null,timeZone,timeUnknown:true,knownDate};}
  assert(typeof input.occurredAt==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.occurredAt)&&Number.isFinite(Date.parse(input.occurredAt)),'Укажите дату и время события');
  day(input.occurredAt.slice(0,10));
  assert(Date.parse(input.occurredAt)<=Date.now()+60000,'Событие не может быть в будущем');
  return {personId:string(input.personId,'Человек',80,true),occurredAt:new Date(input.occurredAt).toISOString(),timeZone:zone(input.timeZone||'Europe/Chisinau'),...(input.timeUnknown===false?{timeUnknown:false,knownDate:''}:{})};
}
export function temperatureInput(input){
  const occurrence=occurrenceInput(input),raw=String(input.celsius??'').trim().replace(',','.');
  assert(/^\d{2}(?:\.\d{1,2})?$/.test(raw)&&Number(raw)>=20&&Number(raw)<=50,'Температура: укажите число от 20 до 50 °C');
  return {...occurrence,celsius:Number(raw),...entryContext(input)};
}
export const activityKinds={temperature:'Температура',diarrhea:'Диарея',vomiting:'Рвота',retching:'Позывы к рвоте',inhalation:'Ингаляция',medication:'Лекарство',other:'Другое'};
export function activityInput(input){
  const occurrence=occurrenceInput(input);assert(Object.hasOwn(activityKinds,input.kind),'Выберите тип события');
  const quick=['diarrhea','vomiting','retching','temperature'].includes(input.kind),amount=positive(input.amount,'Количество',true)||'',unit=string(input.unit,'Единица',30);
  assert((!amount&&!unit)||(amount&&units.includes(unit)),'Укажите количество и его единицу вместе');
  assert(!quick||!amount,'Для этого симптома количество препарата не требуется');
  const clientKey=string(input.clientKey,'Ключ записи',120,true);assert(/^[a-zA-Z0-9_-]{8,120}$/.test(clientKey),'Некорректный ключ записи');
  assert(!input.relatedRxId||['medication','inhalation'].includes(input.kind),'Назначение можно связать только с лекарством или ингаляцией');
  return {...occurrence,...(input.kind==='temperature'?{celsius:temperatureInput(input).celsius}:{}),...entryContext(input),kind:input.kind,name:quick?activityKinds[input.kind]:string(input.name,'Что сделали / препарат',200,true),amount,unit,strength:string(input.strength,'Концентрация',150),note:string(input.note,'Примечание',2000),author:string(input.author||'Я','Автор',100),clientKey};
}
export function courseEnd(startDate,count,unit){
  day(startDate);assert(Number.isInteger(Number(count))&&Number(count)>0&&Number(count)<=3660,'Длительность: положительное целое число');count=Number(count);
  assert(['days','weeks','months'].includes(unit),'Неизвестная единица длительности');
  if(unit==='days'||unit==='weeks')return nextDay(startDate,count*(unit==='weeks'?7:1)-1);
  assert(count<=120,'Не более 120 месяцев');
  const start=new Date(startDate+'T12:00:00Z'),date=start.getUTCDate();start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()+count);
  const last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(date,last));
  return nextDay(start.toISOString().slice(0,10),-1);
}
export function rxInput(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Ожидается назначение');
  const startDate = day(input.startDate), endDate = input.endDate ? day(input.endDate) : '';
  assert(!endDate || endDate >= startDate, 'Окончание курса раньше начала');
  const type = input.type;
  assert(['daily','routine','interval','prn','once'].includes(type), 'Выберите тип расписания');
  const timeZone = zone(string(input.timeZone || 'Europe/Chisinau', 'Часовой пояс', 100));
  const times = type === 'daily' || type === 'once' ? [...new Set(string(input.times, 'Часы приёма', 150, true).split(/[,;\s]+/).filter(Boolean))].sort() : [];
  assert(times.length <= 12, 'Не более 12 приёмов в сутки');
  for (const time of times) zonedInstant(startDate, time, timeZone);
  assert(type !== 'once' || times.length === 1, 'Для разового приёма укажите одно время');
  const intervalHours = type === 'interval' ? Number(positive(input.intervalHours, 'Интервал')) : null;
  assert(type !== 'interval' || intervalHours >= 1 && intervalHours <= 720, 'Интервал: от 1 до 720 часов');
  const anchorTime = type === 'interval' ? string(input.anchorTime, 'Первый приём', 5, true) : '';
  const anchor = type === 'interval' ? zonedInstant(startDate, anchorTime, timeZone) : '';
  assert(units.includes(input.unit), 'Выберите единицу дозировки');
  assert(input.confirmed === true, 'Сверьте назначение с оригиналом и подтвердите поля');
  const ingredients = string(input.ingredients, 'Действующие вещества', 600).split(/[+;,\n]/).map(x=>x.trim()).filter(Boolean);
  if(input.maxPer24h!==''&&input.maxPer24h!=null)assert(Number.isInteger(Number(input.maxPer24h)), 'Максимум приёмов должен быть целым числом');
  const extra={};
  if(input.medicineForm){assert(Object.hasOwn(medicineForms,input.medicineForm),'Выберите форму препарата');assert(allowedMedicineUnits(input.medicineForm).includes(input.unit),'Единица дозы не подходит для формы препарата');if(['кап.','впрыскивание'].includes(input.unit))assert(Number.isInteger(Number(input.dose)),'Капли и впрыскивания: целое количество');extra.medicineForm=input.medicineForm;}
  if(input.regimen!==undefined){const r=input.regimen;assert(r&&typeof r==='object','Укажите рецепт процедуры');if(r.durationMinutes)assert(/^\d{1,3}$/.test(r.durationMinutes)&&Number(r.durationMinutes)>0&&Number(r.durationMinutes)<=240,'Длительность процедуры: от 1 до 240 минут');if(r.minAgeYears!==undefined)assert(Number.isInteger(r.minAgeYears)&&r.minAgeYears>=0&&r.minAgeYears<=130,'Возрастное ограничение: 0–130 лет');extra.regimen={...(r.minAgeYears!==undefined?{minAgeYears:r.minAgeYears}:{}),ageSource:string(r.ageSource,'Источник возраста',1000),packageText:string(r.packageText,'Текст упаковки',2000),origin:string(r.origin,'Источник назначения',30),mixing:string(r.mixing,'Смесь',1000),durationMinutes:string(r.durationMinutes,'Минуты процедуры',10),choiceGroup:string(r.choiceGroup,'Группа альтернатив',100),manufacturer:string(r.manufacturer,'Производитель',200),parserVersion:string(r.parserVersion,'Версия разбора',80)};}
  if(input.importFingerprint!==undefined)extra.importFingerprint=string(input.importFingerprint,'Отпечаток импорта',64);
  if(input.importKey!==undefined)extra.importKey=string(input.importKey,'Ключ импорта',200);
  if(type==='routine')extra.routineSlots=slotsInput(input.routineSlots);
  if(input.legacyTimes!==undefined){assert(Array.isArray(input.legacyTimes)&&input.legacyTimes.length<=12&&input.legacyTimes.every(clock),'Некорректные прежние часы');extra.legacyTimes=[...input.legacyTimes];}
  if(input.carePhase!==undefined)extra.carePhase=phaseInput(input.carePhase);
  if(input.weekdays!==undefined){assert(Array.isArray(input.weekdays)&&input.weekdays.length>0&&input.weekdays.length<=7&&input.weekdays.every(n=>Number.isInteger(n)&&n>=0&&n<=6),'Выберите дни недели');assert(['daily','routine'].includes(type),'Дни недели применяются только к ежедневному расписанию');extra.weekdays=[...new Set(input.weekdays)].sort();}
  if(input.doseScope){assert(['each-nostril','total'].includes(input.doseScope),'Неизвестная область дозы');extra.doseScope=input.doseScope;}
  if(input.medicineId!==undefined)extra.medicineId=string(input.medicineId,'Лекарство',80);
  if(input.manualKey!==undefined){extra.manualKey=string(input.manualKey,'Ключ назначения',120,true);assert(/^[a-zA-Z0-9_-]{8,120}$/.test(extra.manualKey),'Некорректный ключ назначения');}
  if(input.purpose!==undefined)extra.purpose=string(input.purpose,'Зачем назначено',1000);
  return assertContract('PrescriptionInput',{ name: string(input.name, 'Название препарата', 200, true), ingredients, form: string(input.form, 'Форма', 150), strength: string(input.strength, 'Концентрация', 150), dose: positive(input.dose, 'Доза на приём'), unit: input.unit, route: string(input.route, 'Способ применения', 150), startDate, endDate, type, times, timeZone, intervalHours, anchorTime, anchor, minHours: positive(input.minHours, 'Минимальный интервал', true), maxPer24h: positive(input.maxPer24h, 'Максимум приёмов за 24 часа', true), conditions: string(input.conditions, 'Условия приёма', 2000), sourceText: string(input.sourceText, 'Текст назначения', 10000), documentId: string(input.documentId, 'Документ', 80), confirmed: true,...extra });
}
export function scheduleFor(rx, date, person) {
  day(date);
  if (rx.archived || rx.type === 'prn' || date < rx.startDate || rx.endDate && date > rx.endDate || rx.type === 'once' && date !== rx.startDate) return [];
  if(['daily','routine'].includes(rx.type)&&rx.weekdays&&!rx.weekdays.includes(new Date(date+'T12:00:00Z').getUTCDay()))return [];
  if(rx.type==='routine'){
    const profile=dailyRoutine(person);
    return rx.routineSlots.map((original,i)=>{
      const slot=original;
      const details=slotDetails(slot,profile,person?.daySlots?profileSlots(person):[]);
      // Before/after food and ranges do not imply an exact administration time.
      const scheduledAt=clock(details.displayTime)&&!slot.relation?zonedInstant(date,details.displayTime,rx.timeZone):null;
      return {key:`${rx.id}@routine-${date}-${i}`,rxId:rx.id,personId:rx.personId,date,time:scheduledAt?details.displayTime:'',...(scheduledAt?{scheduledAt}:{}),timeZone:rx.timeZone,name:rx.name,dose:rx.dose,unit:rx.unit,ingredients:rx.ingredients,conditions:rx.conditions,doseScope:rx.doseScope,purpose:rx.purpose,carePhase:rx.carePhase,...details,slotIndex:i,...(rx.legacyTimes?.[i]?{legacyKey:`${rx.id}@${zonedInstant(date,rx.legacyTimes[i],rx.timeZone)}`}:{})};
    });
  }
  let instants = [];
  if (rx.type === 'interval') {
    const from = Date.parse(zonedInstant(date, '00:00', rx.timeZone)), to = Date.parse(zonedInstant(nextDay(date), '00:00', rx.timeZone));
    const anchor = Date.parse(rx.anchor), interval = rx.intervalHours * 3600000;
    let i = Math.max(0, Math.ceil((from - anchor) / interval));
    for (let t = anchor + i * interval; t < to; t += interval) instants.push(new Date(t).toISOString());
  } else {
    instants = rx.times.map(time => zonedInstant(date, time, rx.timeZone));
  }
  return instants.map(scheduledAt => ({ key: `${rx.id}@${scheduledAt}`, rxId: rx.id, personId: rx.personId, scheduledAt, ...localParts(scheduledAt, rx.timeZone), timeZone: rx.timeZone, name: rx.name, dose: rx.dose, unit: rx.unit, conditions: rx.conditions, ingredients: rx.ingredients,...(rx.doseScope?{doseScope:rx.doseScope}:{}),...(rx.purpose?{purpose:rx.purpose}:{}),...(rx.carePhase!==undefined?{carePhase:rx.carePhase}:{}) }));
}

// OCR suggestions deliberately keep missing dose, course dates and clock times empty.
export function parseSuggestions(text) {
  const groups=[];let current=null,conditional='',pending='';
  const doseUnit=/(?:мг|мкг|мл|табл|капс|впрыск|\bmg\b|\bml\b|\btablet)/iu;
  const flush=()=>{if(current&&/\d/.test(current.text)&&doseUnit.test(current.text))groups.push(current);current=null;};
  for(const raw of string(text,'Текст выписки',50000).split(/\n+/)){
    const line=raw.trim();if(!line)continue;
    if(/название\s+похоже|неразборчив|\[не\s*ясно\]/iu.test(line)){flush();pending='';continue;}
    if(/^При появлении/iu.test(line)){flush();conditional=line;continue;}
    if(/^следующая лечебная тактика/iu.test(line))continue;
    if(/^Через\s+\d+\s*[–-]\s*\d+\s+минут/iu.test(line)){flush();pending=line;continue;}
    const clean=line.replace(/^\s*(?:\d+[.)]\s+|[•–-]\s*)/u,'').replace(/^(?:Затем\s+)?продолжить лечение препаратом\s+/iu,'');
    const numbered=/^\d+[.)]\s*\p{L}/u.test(line);
    const starts=(doseUnit.test(clean)&&/\d/.test(clean)||/^[\p{L}\d-]+,\s*(?:назальный\s+)?спрей/iu.test(clean))&&!/^(?:в |по |для |через |гипертоническ|изотоническ|понедельника|недель|месяц|ежедневн)/iu.test(clean);
    if(numbered||starts){flush();current={text:(pending?pending+'\n':'')+clean,condition:conditional};pending='';}
    else if(current)current.text+='\n'+line;
  }
  flush();
  return groups.slice(0,40).map(group=>{
    const line=group.text;
    const content=line.split('\n').filter(l=>!/^Через\s+\d/iu.test(l)).join(' ');
    const dose=content.match(/(?:^|\s)по\s+(\d+(?:[.,]\d+)?)\s*(?:(?:жевательн[а-я]*|цел[а-я]*)\s+)?(табл[а-я.]*|капс[а-я.]*|мл|мг|мкг|кап\.?|впрыскиван[а-я]*)/iu);
    const rawUnit=dose?.[2].toLowerCase()||'';
    const unit=rawUnit.startsWith('табл')?'табл.':rawUnit.startsWith('капс')?'капс.':rawUnit.startsWith('впрыск')?'впрыскивание':rawUnit.startsWith('кап')?'кап.':rawUnit||'табл.';
    const strengthMatch=content.match(/\d+(?:[.,]\d+)?\s*(?:мг|мкг|мл|mg|ml)(?:\s*\+\s*\d+(?:[.,]\d+)?\s*(?:мг|мкг|мл|mg|ml))*(?:\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:мл|ml|доза))?/iu);
    const doseIndex=content.search(/\s+по\s+\d/iu);
    const split=strengthMatch?.index??(doseIndex>=0?doseIndex:content.length);
    const name = content.slice(0,split).split(',')[0].replace(/[,;:\s—–-]+$/u,'').trim();
    const strength = strengthMatch?.[0] || '';
    const times=[...content.matchAll(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?=[,\s.]|$)/g)].map(m=>m[1].padStart(2,'0')+':'+m[2]);
    const conditions=[group.condition?'Условная схема: '+group.condition:'',/Через\s+\d+\s*[–-]\s*\d+\s+минут/iu.test(line)?line.split('\n')[0]:'',/вечером/iu.test(content)?'Вечером':'',/перед сном/iu.test(content)?'Перед сном':''].filter(Boolean).join('. ');
    return { name, strength, dose:dose?dose[1].replace(',','.'):'',unit,sourceText:line,conditions,requiresReview:true,review:'Сверьте весь фрагмент, дозу, дату начала и последовательность. Условную ветку не активировать без уточнения.',...(times.length?{times:times.join(', ')}:{}),...(/в каждую ноздрю/iu.test(content)?{doseScope:'each-nostril'}:{}),...(/суббот[а-я]* и воскресень[а-я]*/iu.test(content)?{weekdays:[0,6]}:{}) };
  });
}
export const newId = () => randomUUID();
