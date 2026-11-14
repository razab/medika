import {assertContract} from './pilot-contracts.mjs';
import {assert,string} from './domain.mjs';
import {medicineReferenceInput} from './medicine-reference.mjs';
import {medicineForms} from '../public/medicine-forms.js';
export function medicineInput(input){
  assert(input&&typeof input==='object'&&!Array.isArray(input),'Ожидаются данные лекарства');
  assert(Object.hasOwn(medicineForms,input.medicineForm),'Выберите форму препарата');
  const extra={};if(input.clientKey!==undefined){extra.clientKey=string(input.clientKey,'Ключ лекарства',120,true);assert(/^[a-zA-Z0-9_-]{8,120}$/.test(extra.clientKey),'Некорректный ключ лекарства');}
  for(const [field,max]of [['sourceText',22000],['sourceModel',80],['manufacturer',200]])if(input[field]!==undefined)extra[field]=string(input[field],field,max);
  if(input.aftercare!==undefined)extra.aftercare=string(input.aftercare,'После применения',1200);
  if(input.afterMedicine!==undefined){
    const link=input.afterMedicine;
    if(link===null)extra.afterMedicine=null;
    else{assert(link&&typeof link==='object'&&!Array.isArray(link),'Укажите предыдущий препарат');const medicineId=string(link.medicineId,'Предыдущий препарат',80,true),minMinutes=Number(link.minMinutes),maxMinutes=Number(link.maxMinutes);assert(Number.isInteger(minMinutes)&&Number.isInteger(maxMinutes)&&minMinutes>=1&&maxMinutes>=minMinutes&&maxMinutes<=1440,'Интервал: целые минуты от 1 до 1440, от меньшего к большему');extra.afterMedicine={medicineId,minMinutes,maxMinutes,source:'user'};}
  }
  if(input.reference!==undefined)extra.reference=medicineReferenceInput(input.reference,medicineKey(input));
  if(input.recognitionKey!==undefined){extra.recognitionKey=string(input.recognitionKey,'Ключ распознавания',64);assert(/^[a-f\d]{64}$/.test(extra.recognitionKey),'Некорректный ключ распознавания');}
  return assertContract('MedicineInput',{name:string(input.name,'Название лекарства',200,true),medicineForm:input.medicineForm,strength:string(input.strength,'Дозировка на упаковке',150),instructions:string(input.instructions,'Как применять',2000),archived:input.archived===true,...extra});
}
export const medicineKey=m=>[m.name,m.medicineForm,m.strength].map(s=>String(s||'').trim().toLocaleLowerCase()).join('|');

export function validateMedicineSequence(m,medicines,{allowArchived=false}={}){
  if(!m.afterMedicine)return;
  const all=new Map(medicines.map(x=>[x.id,x]));if(m.id)all.set(m.id,m);
  const first=all.get(m.afterMedicine.medicineId);assert(first&&(allowArchived||!first.archived),'Предыдущий препарат недоступен');
  const seen=new Set(m.id?[m.id]:[]);let current=m;
  while(current?.afterMedicine){const id=current.afterMedicine.medicineId;assert(!seen.has(id),'Последовательность препаратов не может образовывать круг');seen.add(id);current=all.get(id);assert(current,'Предыдущий препарат не найден');}
}
