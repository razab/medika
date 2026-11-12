import {assert,string,day} from './domain.mjs';
export function medicineReferenceInput(input,productKey){
 assert(input&&typeof input==='object'&&!Array.isArray(input),'Некорректная справка препарата');assert(input.productKey===productKey,'Справка относится к другой форме или концентрации препарата');
 assert(['sourced','partial'].includes(input.status),'Укажите полноту источника');const checkedAt=day(input.checkedAt);
 assert(Array.isArray(input.ingredients)&&input.ingredients.length>=0&&input.ingredients.length<=20,'Укажите действующие вещества');
 assert(['unknown','independent','before','with','after','empty','not-applicable'].includes(input.foodRelation),'Некорректная связь с едой');
 const result={productKey,status:input.status,checkedAt,ingredients:input.ingredients.map(x=>string(x,'Действующее вещество',300,true)),foodRelation:input.foodRelation};
 for(const field of ['group','purpose','foodText','timing','administration','storage','cautions','limitations'])result[field]=string(input[field],field,1800);
 assert(result.group&&result.purpose,'Укажите группу и назначение препарата');assert(result.status!=='partial'||result.limitations,'Укажите, что не подтверждено');
 assert(Array.isArray(input.sources)&&input.sources.length>=1&&input.sources.length<=8,'Нужен источник справки');
 result.sources=input.sources.map(source=>{assert(source&&typeof source==='object','Некорректный источник');const url=string(source.url,'Ссылка',2000,true);let parsed;try{parsed=new URL(url);}catch{assert(false,'Некорректная ссылка источника');}assert(['https:','http:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password,'Нужна HTTP(S)-ссылка на источник');assert(['product','ingredient'].includes(source.scope),'Укажите область источника');return {title:string(source.title,'Название источника',300,true),url,scope:source.scope,excerpt:string(source.excerpt,'Фрагмент источника',1000)};});return result;
}
