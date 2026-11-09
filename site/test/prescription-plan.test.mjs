import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePrescription,buildPrescriptionPlan,parsePackage} from '../lib/prescription-plan.mjs';
import {rxInput,scheduleFor} from '../lib/domain.mjs';
import {complexText,demoContext} from '../lib/lab-fixtures.mjs';
test('Выписка сохраняет фазы, выбор одного из двух, десятичную дозу, область и процедуру',()=>{
 const p=parsePrescription(complexText);assert.equal(p.entries.length,5);assert.equal(p.choiceGroups.length,1);assert.equal(p.entries[0].dose,'0.5');assert.equal(p.entries[0].minAgeYears,6);assert.equal(p.entries[2].doseScope,'each-nostril');assert.equal(p.entries[3].carePhase,'acute');assert.equal(p.entries[3].medicineForm,'inhalation');assert.match(p.entries[3].mixing,/NaCl/);assert.equal(p.entries[3].durationMinutes,'7');assert.deepEqual(p.entries[4].times,['17:00']);
 const plan=buildPrescriptionPlan(p,demoContext);assert.equal(plan.unresolvedChoices,1);assert.equal(plan.rows.filter(r=>r.entry.choiceGroup&&r.selected).length,0);assert.ok(plan.rows.find(r=>r.personId==='alice'&&r.entry.name==='AlphaTabs').blockers.some(b=>b.includes('6+')));
});
test('Один выбор → два пациента, разные вторые слоты, будни/выходные, точный час, готовые курсы',()=>{
 const p=parsePrescription(complexText),edits={choices:{[p.choiceGroups[0].id]:p.entries[1].id},people:{alice:{[p.entries[0].id]:{excluded:true}}}};
 const plan=buildPrescriptionPlan(p,demoContext,edits);assert.equal(plan.blocked,0);assert.equal(plan.ready,7);assert.equal(plan.unresolvedChoices,0);
 const a=plan.rows.find(r=>r.personId==='alice'&&r.entry.name==='BetaDrops'),d=plan.rows.find(r=>r.personId==='danya'&&r.entry.name==='BetaDrops');assert.deepEqual(a.weekday.map(s=>s.id),['breakfast','dinner','secondDinner']);assert.deepEqual(d.weekday.map(s=>s.id),['breakfast','lunch','dinner']);
 const rx={...a.prescription,id:'rx',personId:'alice'};assert.deepEqual(scheduleFor(rx,'2026-11-09',plan.context.people[0]).map(s=>s.time),['07:30','19:00','21:30']);assert.deepEqual(scheduleFor(rx,'2026-11-14',plan.context.people[0]).map(s=>s.time),['09:00','14:00','19:00']);assert.equal(rx.endDate,'2026-11-18');
});
test('Недостаток слотов, диапазоны и последовательность требуют уточнения; форма ограничивает единицы',()=>{
 const p=parsePrescription('Поддерживающее лечение\n1. Test капли 5 мг/мл — по 2 капли 4 раза в день, курс 5–7 дней.\nЗатем продолжить лечение\n2. Other таблетки 10 мг — по 1 таблетке 1 раз в день.');
 const plan=buildPrescriptionPlan(p,demoContext);assert.ok(plan.rows[0].blockers.some(b=>b.includes('слотов')));assert.ok(plan.rows[0].blockers.some(b=>b.includes('длительность')));assert.ok(plan.rows[1].blockers.some(b=>b.includes('этап')));
 assert.throws(()=>rxInput({name:'Капли',medicineForm:'drops',dose:'.5',unit:'табл.',type:'daily',times:'08:00',startDate:'2026-11-09',confirmed:true}));
});
test('Упаковка: концентрация, производитель, форма и возраст; смесь с водой не генерируется как рецепт',()=>{
 const pack=parsePackage('Пульмикорт\n0,25 мг/мл\nСуспензия для ингаляций\nПроизводитель: AstraZeneca\nС 6 лет');assert.equal(pack.medicineForm,'inhalation');assert.equal(pack.minAgeYears,6);assert.equal(pack.manufacturer,'AstraZeneca');assert.equal(pack.strength,'0,25 мг/мл');
 const p=parsePrescription('Pulmicort суспензия для ингаляций 0,25 мг/мл — по 1 мл 2 раза в день.\nСмешать с 1 мл воды.');const plan=buildPrescriptionPlan(p,demoContext);assert.equal(plan.ready,0);assert.ok(plan.rows[0].blockers.some(b=>b.includes('вод')));assert.equal(plan.rows[0].entry.durationMinutes,'');
});
test('Десять назначений автоматически распределяются двум людям без ручных часов',()=>{
 const p=parsePrescription('Поддерживающее лечение\n'+Array.from({length:10},(_,i)=>`${i+1}. Test${i} капли 5 мг/мл — по 3 капли 3 раза в день, курс 7 дней.`).join('\n'));
 const plan=buildPrescriptionPlan(p,demoContext);assert.equal(plan.ready,20);assert.equal(plan.blocked,0);assert.ok(plan.rows.every(r=>r.weekday.length===3&&r.weekend.length===3));
});
test('ИЛИ в одной строке сохраняет общую дозу и исходную цитату, а не создаёт совместный приём',()=>{
 const source='AlphaTabs 10 мг или OtherTabs 10 мг — по 1 таблетке 2 раза в день.';
 const p=parsePrescription(source);assert.equal(p.entries.length,2);assert.equal(p.choiceGroups.length,1);assert.ok(p.entries.every(e=>e.dose==='1'&&e.frequency===2&&e.sourceText===source));assert.equal(buildPrescriptionPlan(p,demoContext).ready,0);
});
test('Относительный порядок не теряется; последующий этап не активируется одновременно',()=>{
 const p=parsePrescription('Острая фаза\n1. TestSpray спрей 10 мг/мл — по 1 впрыскиванию 3 раза в день, курс 7 дней.\nЧерез 10–15 минут после применения TestSpray использовать\n2. OtherSpray спрей 10 мг/мл — по 1 впрыскиванию 3 раза в день, курс 7 дней.\nЗатем продолжить лечение препаратом FinalSpray 10 мг/мл — по 1 впрыскиванию 3 раза в день, курс 14 дней.');
 assert.equal(p.entries.length,3);assert.match(p.entries[1].conditions,/10–15/);assert.ok(!p.entries[1].issues.some(t=>t.includes('этап')));assert.ok(p.entries[2].issues.some(t=>t.includes('этап')));
});
test('Вечером без выдуманных часов, полтаблетки и курс только по выходным',()=>{
 const p=parsePrescription('1. NightTabs таблетки 10 мг — по полтаблетки вечером, курс 7 дней.\n2. WeekendTabs таблетки 10 мг — по 1 таблетке 1 раз в день по субботам и воскресеньям, курс 6 недель.');
 assert.equal(p.entries[0].dose,'0.5');assert.equal(p.entries[0].frequency,1);assert.deepEqual(p.entries[1].weekdays,[0,6]);const plan=buildPrescriptionPlan(p,demoContext);assert.equal(plan.ready,4);const r=plan.rows.find(r=>r.entry.name==='WeekendTabs');assert.equal(scheduleFor({...r.prescription,id:'r'},'2026-11-09',plan.context.people[0]).length,0);assert.equal(scheduleFor({...r.prescription,id:'r'},'2026-11-14',plan.context.people[0]).length,1);
});
test('Три альтернативы сохраняются; оборванное ИЛИ и отмена не разрешают автоматический перенос',()=>{
 const p=parsePrescription('AlphaTabs 10 мг или OtherTabs 10 мг либо ThirdTabs 10 мг — по 1 таблетке 2 раза в день.');assert.equal(p.entries.length,3);assert.equal(p.choiceGroups[0].entryIds.length,3);assert.ok(p.entries.every(e=>e.dose==='1'));assert.equal(buildPrescriptionPlan(p,demoContext).ready,0);
 const broken=parsePrescription('AlphaTabs таблетки 10 мг — по 1 таблетке 2 раза в день.\nИЛИ');assert.ok(buildPrescriptionPlan(broken,demoContext).rows.every(r=>r.blockers.some(s=>s.includes('Незаверш'))));
 const stopped=parsePrescription('AlphaTabs таблетки 10 мг — не принимать по 1 таблетке 2 раза в день.');assert.equal(buildPrescriptionPlan(stopped,demoContext).ready,0);
});
test('Саше остаётся саше; упаковка капель не подтверждает ошибочную форму таблеток',()=>{
 const p=parsePrescription('PowderTest порошок 100 мг — по 1 пакету 2 раза в день, курс 7 дней.');assert.equal(p.entries[0].medicineForm,'powder');assert.equal(p.entries[0].unit,'пакет');assert.equal(buildPrescriptionPlan(p,demoContext).ready,2);
 const tablet=parsePrescription('Tabs таблетки 10 мг — по 1 таблетке 2 раза в день.');const e=tablet.entries[0],plan=buildPrescriptionPlan(tablet,demoContext,{packages:{[e.id]:{medicineForm:'drops',strength:'10 мг',text:'Капли'}}});assert.equal(plan.ready,0);assert.ok(plan.rows[0].blockers.some(s=>s.includes('Форма на упаковке')));
});
test('Старый выбор после исправления OCR не скрывает весь новый набор альтернатив',()=>{
 const first=parsePrescription('AlphaTabs 10 мг или OtherTabs 10 мг — по 1 таблетке 2 раза в день.');const corrected=parsePrescription('AlphaTabs 10 мг или OtherTabs 10 мг — по 2 таблетки 2 раза в день.');const plan=buildPrescriptionPlan(corrected,demoContext,{choices:{[first.choiceGroups[0].id]:first.entries[0].id}});assert.equal(plan.unresolvedChoices,1);assert.equal(plan.ready,0);assert.ok(plan.rows.every(r=>r.choiceRequired));
});
test('Один указанный час не превращает три приёма в один',()=>{
 const p=parsePrescription('Test капли 5 мг/мл — по 3 капли 3 раза в день, в 17:00.');const plan=buildPrescriptionPlan(p,demoContext);assert.equal(plan.ready,0);assert.ok(plan.rows.every(r=>r.blockers.some(s=>s.includes('Кратность и часы'))));
});
test('Разовый приём не становится ежедневным курсом ни с часами, ни со слотом еды',()=>{
 for(const text of ['Test таблетки 10 мг — по 1 таблетке однократно в 17:00.','Test таблетки 10 мг — по 1 таблетке однократно.']){const plan=buildPrescriptionPlan(parsePrescription(text),demoContext);assert.equal(plan.ready,2);const row=plan.rows[0],rx={...row.prescription,id:'r'};assert.equal(rx.endDate,demoContext.startDate);assert.equal(scheduleFor(rx,'2026-11-09',plan.context.people[0]).length,1);assert.equal(scheduleFor(rx,'2026-11-10',plan.context.people[0]).length,0);}
});
