import {escapeHTML as e} from './family-card.js';
export function medicineReferenceHTML(reference){
 if(!reference)return '';
 const fields=[['Действующие вещества',reference.ingredients.join(' · ')],['Группа',reference.group],['Для чего',reference.purpose],['Еда',reference.foodText||({'unknown':'Не подтверждено','independent':'Независимо от еды','before':'До еды','with':'Во время еды','after':'После еды','empty':'Натощак','not-applicable':'Не применяется к этому способу введения'}[reference.foodRelation])],['Время суток',reference.timing],['Как применять',reference.administration]];
 return `<section class="medicine-reference"><h3>О препарате</h3>${reference.limitations?`<p class="reference-limitations">${e(reference.limitations)}</p>`:''}<dl>${fields.filter(([,text])=>text).map(([label,text])=>`<div><dt>${e(label)}</dt><dd>${e(text)}</dd></div>`).join('')}</dl>${reference.storage||reference.cautions?`<details><summary>Хранение и ограничения</summary>${reference.storage?`<h4>Хранение</h4><p>${e(reference.storage)}</p>`:''}${reference.cautions?`<h4>Ограничения и сочетания</h4><p>${e(reference.cautions)}</p>`:''}</details>`:''}<details><summary>Источники · проверено ${e(reference.checkedAt.split('-').reverse().join('.'))}</summary><div class="medicine-reference-sources">${reference.sources.map(source=>`<a href="${e(source.url)}" target="_blank" rel="noreferrer">${e(source.title)}${source.scope==='ingredient'?' · сведения о действующем веществе':''}</a>${source.excerpt?`<p class="reference-excerpt">${e(source.excerpt)}</p>`:''}`).join('')}</div></details></section>`;
}

export function medicineGroupLabel(reference){
 const group=reference?.group?.trim();if(!group)return 'Группа не уточнена';
 const labels=[];
 if(/антибиотик/iu.test(group))labels.push('Антибиотик');
 if(/кортикостероид/iu.test(group))labels.push('кортикостероид');
 if(labels.length){const text=labels.join(' + ');return text[0].toUpperCase()+text.slice(1);}
 return /пищевая добавка|^НПВП/iu.test(group)?group:group.split(' · ')[0];
}
