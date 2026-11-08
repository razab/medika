import test from 'node:test';
import assert from 'node:assert/strict';
import {prescriptionSummary} from '../public/prescription-summary.js';
test('Краткое назначение: доза, частота, часы и последовательность без повторения условия фазы',()=>{
  const a=prescriptionSummary({dose:'2',unit:'впрыскивание',doseScope:'each-nostril',sourceText:'ТестСпрей по 2 впрыскивания в каждую ноздрю 3 раза в день, не более 10 дней.',conditions:'Условная схема: При появлении окрашенных выделений'});
  assert.deepEqual(a,{dose:'2 впрыскивания в каждую ноздрю',frequency:'3 раза в день',details:''});
  const b=prescriptionSummary({dose:'1',unit:'впрыскивание',sourceText:'Через 10–15 минут после применения ТестСпрей использовать\nТестСпрейБ по 1 впрыскиванию 3 раза\nв день.'});assert.equal(b.dose,'1 впрыскивание');assert.equal(b.frequency,'3 раза в день');assert.equal(b.details,'Через 10–15 мин после ТестСпрей');
  assert.equal(prescriptionSummary({dose:'2.5',unit:'мл',sourceText:'100 мг / 5 мл'}).frequency,'Частота не указана');
  assert.equal(prescriptionSummary({type:'daily',times:['08:00','20:00'],sourceText:'1 раз в день'}).frequency,'2 раза в день');
  assert.equal(prescriptionSummary({type:'interval',intervalHours:'8'}).frequency,'Каждые 8 ч');assert.equal(prescriptionSummary({type:'prn'}).frequency,'По необходимости');
  assert.equal(prescriptionSummary({sourceText:'до 3 раз в сутки'}).frequency,'до 3 раз в сутки');assert.equal(prescriptionSummary({sourceText:'не чаще 2 раз в день'}).frequency,'не чаще 2 раз в день');assert.equal(prescriptionSummary({sourceText:'1–2 раза в неделю'}).frequency,'1–2 раза в неделю');
});
