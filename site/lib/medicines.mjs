import {assert,string} from './domain.mjs';
import {medicineForms} from '../public/medicine-forms.js';
export function medicineInput(input){
  assert(input&&typeof input==='object'&&!Array.isArray(input),'Ожидаются данные лекарства');
  assert(Object.hasOwn(medicineForms,input.medicineForm),'Выберите форму препарата');
  const extra={};if(input.clientKey!==undefined){extra.clientKey=string(input.clientKey,'Ключ лекарства',120,true);assert(/^[a-zA-Z0-9_-]{8,120}$/.test(extra.clientKey),'Некорректный ключ лекарства');}
  for(const [field,max]of [['sourceText',22000],['sourceModel',80],['manufacturer',200]])if(input[field]!==undefined)extra[field]=string(input[field],field,max);
  if(input.recognitionKey!==undefined){extra.recognitionKey=string(input.recognitionKey,'Ключ распознавания',64);assert(/^[a-f\d]{64}$/.test(extra.recognitionKey),'Некорректный ключ распознавания');}
  return {name:string(input.name,'Название лекарства',200,true),medicineForm:input.medicineForm,strength:string(input.strength,'Дозировка на упаковке',150),instructions:string(input.instructions,'Как применять',2000),archived:input.archived===true,...extra};
}
export const medicineKey=m=>[m.name,m.medicineForm,m.strength].map(s=>String(s||'').trim().toLocaleLowerCase()).join('|');
