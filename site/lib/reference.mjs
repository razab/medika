import { localParts } from './domain.mjs';

const root = 'https://medlineplus.gov/druginfo/meds/';
export const catalog = [
  { id:'paracetamol', name:'Парацетамол', aliases:['paracetamol','acetaminophen','парацетамол'], source:root+'a681004.html', summary:'Проверяйте состав комбинированных средств: одно действующее вещество может встречаться под разными названиями.' },
  { id:'ibuprofen', name:'Ибупрофен', aliases:['ibuprofen','ибупрофен'], source:root+'a682159.html', summary:'В локальном наборе есть предупреждение о сочетании с варфарином.' },
  { id:'warfarin', name:'Варфарин', aliases:['warfarin','варфарин','warfarin sodium','варфарин натрия'], source:root+'a682277.html', summary:'Доза индивидуальна. Начало других лекарств требует согласования с врачом или фармацевтом; некоторые сочетания увеличивают риск кровотечения.' },
  { id:'levothyroxine', name:'Левотироксин', aliases:['levothyroxine','левотироксин','левотироксин натрия','levothyroxine sodium'], source:root+'a682461.html', summary:'В справочном источнике указан интервал не менее четырёх часов с карбонатом кальция и сульфатом железа. Уточняйте инструкцию конкретного препарата.' },
  { id:'calcium-carbonate', name:'Кальция карбонат', aliases:['calcium carbonate','кальция карбонат','карбонат кальция'], source:root+'a682461.html', summary:'Для сочетания с левотироксином есть отдельное правило интервала.' },
  { id:'ferrous-sulfate', name:'Железа сульфат', aliases:['ferrous sulfate','железа сульфат','сульфат железа'], source:root+'a682461.html', summary:'Для сочетания с левотироксином есть отдельное правило интервала.' },
  { id:'sildenafil', name:'Силденафил', aliases:['sildenafil','силденафил'], source:root+'a699015.html', summary:'В источнике указана несовместимость с нитратами, включая нитроглицерин. Не менять схему самостоятельно.' },
  { id:'nitroglycerin', name:'Нитроглицерин', aliases:['nitroglycerin','glyceryl trinitrate','нитроглицерин'], source:root+'a699015.html', summary:'В локальном наборе есть предупреждение о сочетании с силденафилом.' }
];
export const rules = [
  { id:'warfarin-ibuprofen', a:'warfarin', b:'ibuprofen', severity:'important', title:'Варфарин и ибупрофен', text:'Возможное взаимодействие и риск кровотечения. До начала такого сочетания обсудите его с врачом или фармацевтом. Самостоятельно не отменяйте назначенное лечение.', source:root+'a682277.html' },
  { id:'thyroxine-calcium', a:'levothyroxine', b:'calcium-carbonate', severity:'interval', title:'Левотироксин и карбонат кальция', text:'Источник указывает разнести приём как минимум на 4 часа. Сверьте конкретные препараты и расписание с врачом или фармацевтом.', source:root+'a682461.html', hours:4 },
  { id:'thyroxine-iron', a:'levothyroxine', b:'ferrous-sulfate', severity:'interval', title:'Левотироксин и сульфат железа', text:'Источник указывает разнести приём как минимум на 4 часа. Сверьте конкретные препараты и расписание с врачом или фармацевтом.', source:root+'a682461.html', hours:4 },
  { id:'sildenafil-nitrate', a:'sildenafil', b:'nitroglycerin', severity:'important', title:'Силденафил и нитроглицерин', text:'В источнике указано, что нитраты не следует сочетать с силденафилом. Требуется уточнение у врача. Простое изменение часов не считается устранением взаимодействия.', source:root+'a699015.html' }
];
export const referenceInfo = { updated:'2026-11-08', scope:'Ограниченный локальный набор: 8 веществ и 4 правила. Полная база взаимодействий не подключена. Инструкции относятся к справочным источникам США; они не заменяют инструкцию вашей упаковки.', source:'MedlinePlus / National Library of Medicine' };
export const normalize = s => String(s).normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[.\s-]+/g,' ').trim();
export function ingredient(s) { const n = normalize(s); return catalog.find(c=>c.aliases.some(a=>normalize(a)===n))?.id || n; }
const substances = rx => (rx.ingredients || []).map(ingredient);

export function checkPerson(state, {personId, candidate=null, excludeId='', at=new Date().toISOString()} = {}) {
  const person = state.people.find(p=>p.id===personId);
  const relevant = state.prescriptions.filter(r=>r.personId===personId && !r.archived && r.id!==excludeId && r.startDate <= localParts(at,r.timeZone).date && (!r.endDate || r.endDate>=localParts(at,r.timeZone).date));
  const meds = candidate ? [...relevant, {...candidate,id:'candidate'}] : relevant;
  const findings = [], unknown = new Set();
  for (const rx of meds) {
    if (!rx.ingredients?.length) unknown.add(rx.name + ': не указан состав');
    for (const s of rx.ingredients || []) if(!catalog.some(c=>c.id===ingredient(s))) unknown.add(s);
    const allergyTokens = (person?.allergies || '').split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean).map(ingredient);
    for (const s of substances(rx)) if(allergyTokens.includes(s)) findings.push({ id:`allergy-${rx.id}-${s}`, severity:'important', title:'Совпадение с указанной аллергией', text:`${rx.name}: вещество совпадает с записью в профиле. Уточните назначение у врача; другие аллергии и перекрёстные реакции автоматически не исключаются.`, source:'', medicines:[rx.name] });
  }
  for(let i=0;i<meds.length;i++) for(let j=i+1;j<meds.length;j++) {
    const a=meds[i], b=meds[j], sa=substances(a), sb=substances(b);
    const shared=sa.filter(x=>sb.includes(x));
    if(shared.length) findings.push({id:`duplicate-${a.id}-${b.id}`,severity:'important',title:'Повторяется действующее вещество',text:`${a.name} + ${b.name}: ${shared.map(x=>catalog.find(c=>c.id===x)?.name||x).join(', ')}. Сверьте назначения, чтобы исключить непреднамеренное повторение.`,source:'https://www.fda.gov/drugs/resources-drugs/drug-interactions-what-you-should-know',medicines:[a.name,b.name]});
    for (const rule of rules) if(sa.includes(rule.a)&&sb.includes(rule.b)||sa.includes(rule.b)&&sb.includes(rule.a)) findings.push({...rule,id:`${rule.id}-${a.id}-${b.id}`,medicines:[a.name,b.name]});
  }
  return { status:'incomplete', findings, unknown:[...unknown], ...referenceInfo, historyNotice:'Записи препаратов и процедур вне схемы не включены в эту проверку. Завершённые курсы и остаточное действие препаратов не оцениваются автоматически. Возрастные дозы, состояния и перекрёстные аллергии требуют отдельной проверки.' };
}

export function intakeWarnings(state, rx, occurredAt) {
  const recent = state.events.filter(e=>e.rxId===rx.id && e.status==='taken' && Date.parse(e.occurredAt)<=Date.parse(occurredAt));
  const warnings=[];
  if (recent.length && rx.minHours) {
    const previous = recent.reduce((a,b)=>Date.parse(a.occurredAt)>Date.parse(b.occurredAt)?a:b);
    if(Date.parse(occurredAt)-Date.parse(previous.occurredAt)<Number(rx.minHours)*3600000) warnings.push(`С предыдущего приёма прошло меньше указанного интервала ${rx.minHours} ч.`);
  }
  if(rx.maxPer24h && recent.filter(e=>Date.parse(e.occurredAt)>Date.parse(occurredAt)-86400000).length>=Number(rx.maxPer24h)) warnings.push(`Достигнуто указанное в назначении число приёмов за 24 часа: ${rx.maxPer24h}.`);
  return warnings;
}
