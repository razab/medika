import { randomUUID } from 'node:crypto';

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
export function personInput(input) {
  const birthday = input.birthday ? day(input.birthday) : '';
  assert(!birthday || birthday <= new Date().toISOString().slice(0, 10), 'Дата рождения не может быть в будущем');
  return { name: string(input.name, 'Имя', 100, true), birthday, weight: positive(input.weight, 'Вес', true), allergies: string(input.allergies, 'Аллергии', 1000), notes: string(input.notes, 'Примечания', 3000), color: ['mint','blue','peach','lilac'].includes(input.color) ? input.color : 'mint' };
}
export const units = ['табл.', 'капс.', 'мл', 'мг', 'мкг', 'г', 'кап.', 'доза', 'пакет', 'свеча', 'нанесение'];
export function rxInput(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Ожидается назначение');
  const startDate = day(input.startDate), endDate = input.endDate ? day(input.endDate) : '';
  assert(!endDate || endDate >= startDate, 'Окончание курса раньше начала');
  const type = input.type;
  assert(['daily','interval','prn','once'].includes(type), 'Выберите тип расписания');
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
  return { name: string(input.name, 'Название препарата', 200, true), ingredients, form: string(input.form, 'Форма', 150), strength: string(input.strength, 'Концентрация', 150), dose: positive(input.dose, 'Доза на приём'), unit: input.unit, route: string(input.route, 'Способ применения', 150), startDate, endDate, type, times, timeZone, intervalHours, anchorTime, anchor, minHours: positive(input.minHours, 'Минимальный интервал', true), maxPer24h: positive(input.maxPer24h, 'Максимум приёмов за 24 часа', true), conditions: string(input.conditions, 'Условия приёма', 2000), sourceText: string(input.sourceText, 'Текст назначения', 10000), documentId: string(input.documentId, 'Документ', 80), confirmed: true };
}
export function scheduleFor(rx, date) {
  day(date);
  if (rx.archived || rx.type === 'prn' || date < rx.startDate || rx.endDate && date > rx.endDate || rx.type === 'once' && date !== rx.startDate) return [];
  let instants = [];
  if (rx.type === 'interval') {
    const from = Date.parse(zonedInstant(date, '00:00', rx.timeZone)), to = Date.parse(zonedInstant(nextDay(date), '00:00', rx.timeZone));
    const anchor = Date.parse(rx.anchor), interval = rx.intervalHours * 3600000;
    let i = Math.max(0, Math.ceil((from - anchor) / interval));
    for (let t = anchor + i * interval; t < to; t += interval) instants.push(new Date(t).toISOString());
  } else {
    instants = rx.times.map(time => zonedInstant(date, time, rx.timeZone));
  }
  return instants.map(scheduledAt => ({ key: `${rx.id}@${scheduledAt}`, rxId: rx.id, personId: rx.personId, scheduledAt, ...localParts(scheduledAt, rx.timeZone), timeZone: rx.timeZone, name: rx.name, dose: rx.dose, unit: rx.unit, conditions: rx.conditions, ingredients: rx.ingredients }));
}

// OCR suggestions deliberately keep missing dose, course dates and clock times empty.
export function parseSuggestions(text) {
  return string(text, 'Текст выписки', 50000).split(/\n+/).map(line=>line.trim()).filter(line=>/\d/.test(line) && /(?:мг|мкг|мл|табл|капс|кап\.|\bmg\b|\bml\b|\btablet)/iu.test(line)).slice(0,40).map(line => {
    const dose = line.match(/(?:^|\s)по\s+(\d+(?:[.,]\d+)?)\s*(табл\.?|капс\.?|мл|мг|мкг|кап\.?)/iu);
    const unitMap = {табл:'табл.',капс:'капс.',мл:'мл',мг:'мг',мкг:'мкг',кап:'кап.'};
    const content=line.replace(/^\s*(?:\d+[.)]\s+|[•–-]\s*)/u,'');
    const strengthMatch=content.match(/\d+(?:[.,]\d+)?\s*(?:мг|мкг|мл|mg|ml)(?:\s*\/\s*\d+(?:[.,]\d+)?\s*(?:мл|ml))?/iu);
    const doseIndex=content.search(/\s+по\s+\d/iu);
    const split=strengthMatch?.index??(doseIndex>=0?doseIndex:content.length);
    const name = content.slice(0,split).replace(/[,;:\s-]+$/u,'').trim();
    const strength = strengthMatch?.[0] || '';
    return { name, strength, dose: dose ? dose[1].replace(',','.') : '', unit: dose ? unitMap[dose[2].replace('.','').toLowerCase()] : 'табл.', sourceText: line, conditions: '', review: 'Проверьте название, дозу, даты и часы по оригиналу' };
  });
}
export const newId = () => randomUUID();
