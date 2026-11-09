export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const check='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
export function careDrug(name,dose,instruction,{later=false,after='',readOnly=false,taken=false,status=''}={}){
  const e=escapeHTML;
  return `<div class="care-med${later?' care-med-later':''}"><details><summary><span class="care-med-name" data-drug-name>${e(name)}</span><strong class="care-dose">${e(dose)}</strong></summary><div class="care-instruction"><span>Назначение</span><p>${e(instruction)}</p></div></details>${later?'':`<label class="care-take${readOnly?' is-readonly':''}"><input type="checkbox" aria-label="${e(name)}: ${readOnly?(taken?'приём записан':'нет отметки в журнале'):'принято в макете'}"${readOnly?' disabled':''}${taken?' checked':''}><span>${check}</span></label>`}${after?`<p class="care-followup">${e(after)}</p>`:''}${status?`<p class="care-followup">${e(status)}</p>`:''}</div>`;
}
export function careFamily(people=[{id:'alice',name:'Алиса'},{id:'danya',name:'Даня'},{id:'mom',name:'Мама'},{id:'dad',name:'Папа'}],selected='all'){
  return `<form class="care-family"><fieldset><legend class="sr-only">Человек</legend>${[{id:'all',name:'Все'},...people].map(p=>`<label><input class="sr-only" type="radio" name="care-person" value="${escapeHTML(p.id)}"${p.id===selected?' checked':''}><span>${escapeHTML(p.name)}</span></label>`).join('')}</fieldset></form>`;
}
