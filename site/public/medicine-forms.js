export const medicineForms={powder:{name:'Порошок / саше',units:['пакет','г','мг']},tablet:{name:'Таблетки',units:['табл.','мг']},capsule:{name:'Капсулы',units:['капс.','мг']},drops:{name:'Капли',units:['кап.','мл']},spray:{name:'Спрей',units:['впрыскивание','доза']},liquid:{name:'Раствор / сироп',units:['мл','мг']},inhalation:{name:'Для ингаляций',units:['мл','мг']},suppository:{name:'Свечи',units:['свеча','мг']},topical:{name:'Наружно',units:['нанесение','г']}};
export function inferMedicineForm(text=''){
  if(/ингаляц|небулайзер|nebulis|inhalation|respules|пульмикорт|pulmicort/iu.test(text))return 'inhalation';
  if(/порошок|пакетик|саше|powder|sachet/iu.test(text))return 'powder';
  if(/спрей|впрыск|spray/iu.test(text))return 'spray';
  if(/капли|капель|капл[яи]|drops/iu.test(text))return 'drops';
  if(/таблет|табл\.|tablets/iu.test(text))return 'tablet';
  if(/капсул|capsules/iu.test(text))return 'capsule';
  if(/свеч|суппозит|suppositor/iu.test(text))return 'suppository';
  if(/мазь|крем|нанес|ointment/iu.test(text))return 'topical';
  if(/сироп|раствор|суспенз|syrup|solution|suspension/iu.test(text))return 'liquid';
  return '';
}
export function allowedMedicineUnits(form){return medicineForms[form]?.units||['табл.','капс.','мл','мг','мкг','г','кап.','доза','впрыскивание','пакет','свеча','нанесение'];}
