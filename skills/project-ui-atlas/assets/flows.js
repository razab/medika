import {autoTags,rebaseManual,flowDiff,flowImpact} from './flow-model.js';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function flows(app,atlas){
 let token,state,current,draft,dirty=false,wordMode=false,range=null,history=[],pickedVersion=null,busy=false;
 const session=await fetch('/api/session');if(!session.ok)throw Error('Не удалось открыть локальную сессию');token=(await session.json()).token;
 async function api(path='',input,method='GET'){const r=await fetch('/api/ui-atlas/flows'+path,{method,headers:{'X-Medika-Token':token,...(input?{'Content-Type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error||'Не удалось сохранить');return value;}
 state=await api();
 const entity=id=>state.entities.find(v=>v.id===id),action=id=>atlas.actions.find(v=>v.id===id);
 const linkAction=id=>`<a href="/ui-atlas#action=${encodeURIComponent(id)}">${e(action(id)?.label||id)}</a>`;
 const lock=()=>{busy=true;for(const n of app.querySelectorAll('input,textarea,select,button'))if(!n.disabled){n.disabled=true;n.dataset.busyLock='1';}};
 const unlock=()=>{for(const n of app.querySelectorAll('[data-busy-lock]')){n.disabled=false;delete n.dataset.busyLock;}};
 const refTitle=id=>entity(id)?.title||(id?'Недоступный объект: '+id:'Без тега');
 const message=(text,error=false)=>{const n=app.querySelector('#flow-message');n.textContent=text;n.setAttribute('role',error?'alert':'status');};
 function list(){app.querySelector('#flow-choice').value=current.id;app.querySelector('#flow-list').innerHTML=state.flows.map(f=>`<button type="button" data-flow="${e(f.id)}" aria-pressed="${f.id===current.id}"><strong>${e(f.id)} · ${e(f.title)}</strong><small>v${f.revision} · ${f.revision>f.reviewedRevision?'Есть правки для разбора':'Исходное / разобрано'}</small></button>`).join('');}
 async function select(id){
  const previousBusy=busy;lock();
  try{
  const next=state.flows.find(f=>f.id===id)||state.flows[0],versions=(await api('/'+next.id+'/history')).versions;
  current=next;draft=structuredClone(current);dirty=false;range=null;wordMode=false;pickedVersion=null;history=versions;
  window.history.replaceState(null,'','#'+current.id);
  app.innerHTML=`<p class="flow-intro">${e(state.scope)} Теги связывают слова с объектами и кодом, а не с реальными семейными записями. Правки сценария сами не меняют приложение.</p><div class="flows-layout"><aside class="flow-index"><h2>Сценарии · ${state.flows.length}</h2><label class="flow-choice-label">Выбрать сценарий<select id="flow-choice">${state.flows.map(f=>`<option value="${e(f.id)}">${e(f.id+' · '+f.title)}</option>`).join('')}</select></label><div id="flow-list"></div></aside><section class="flow-editor"><div class="flow-toolbar"><h2 id="flow-heading"></h2><span id="flow-dirty"></span></div><label>Название<input id="flow-title" maxlength="200"></label><label>Пользовательский путь<textarea id="flow-text" rows="8" maxlength="20000"></textarea></label><p class="flow-help">Редактируйте текст — известные термины отмечаются автоматически. Нажмите тег, чтобы увидеть конкретный объект. Для другого слова включите разметку; для фразы выделите текст в поле и нажмите «Тег выделения».</p><div class="flow-toolbar"><button type="button" data-word-mode aria-pressed="false">Разметка слов</button><button type="button" data-tag-selection>Тег выделения</button></div><div id="flow-annotated" class="flow-annotated" aria-label="Текст со ссылками на объекты"></div><section id="tag-picker" class="tag-picker" hidden aria-label="Объект для слова"><h3 id="tag-heading"></h3><div id="tag-details"></div><label>Найти объект<input type="search" id="tag-search" placeholder="Препарат, назначение, экран…"></label><div id="tag-options"></div><button type="button" data-close-picker>Закрыть разметку</button></section><label>Комментарий к правке<input id="flow-note" maxlength="1200" placeholder="Зачем меняем сценарий"></label><div class="flow-toolbar"><button type="button" data-save-flow class="primary">Сохранить версию</button><button type="button" data-discard-flow>Отменить правки</button></div><p id="flow-message" role="status" aria-live="polite"></p><section class="flow-section"><h3>Связанные действия исходного пути</h3><div class="flow-links">${current.actionIds.map(linkAction).join('')}</div><h3>Что проверить после правок</h3><div id="flow-impact"></div></section><section class="flow-section"><h3>Изменения для Codex</h3><p>Сравнение с последней разобранной версией. Задача сохраняет обе версии, теги, диф и возможные затронутые экраны и компоненты.</p><div id="flow-pending-diff"></div><button type="button" data-request-review>Подготовить задачу для Codex</button><div id="review-result"></div></section><section class="flow-section"><h3>История версий</h3><div id="flow-versions" class="flow-toolbar"></div><div id="flow-version-detail"></div></section></section></div>`;
  app.querySelector('#flow-title').value=draft.title;app.querySelector('#flow-text').value=draft.text;
  list();refresh();renderHistory();renderReview();
  }finally{busy=previousBusy;unlock();}
 }
 function refresh(){
  app.querySelector('#flow-heading').textContent=current.id+' · версия '+current.revision;
  app.querySelector('#flow-dirty').textContent=dirty?'Не сохранено':'Сохранено';
  app.querySelector('[data-save-flow]').disabled=!dirty;
  app.querySelector('[data-request-review]').disabled=dirty||current.revision===current.reviewedRevision;
  annotate();impact();
  const base=history.find(v=>v.revision===current.reviewedRevision);app.querySelector('#flow-pending-diff').innerHTML=diffHTML(base,current);
 }
 function annotate(){
  const container=app.querySelector('#flow-annotated');let html='',at=0;
  function plain(text,offset){if(!wordMode)return e(text);return [...text.matchAll(/[\p{L}\p{N}_-]+|[^\p{L}\p{N}_-]+/gu)].map(m=>/[\p{L}\p{N}]/u.test(m[0])?`<button type="button" class="flow-word" data-range="${offset+m.index}:${offset+m.index+m[0].length}">${e(m[0])}</button>`:e(m[0])).join('');}
  for(const tag of draft.tags){html+=plain(draft.text.slice(at,tag.start),at);const ent=entity(tag.ref);html+=`<button type="button" class="flow-tag${tag.mode==='manual'?' manual':''}" data-range="${tag.start}:${tag.end}" title="${e(refTitle(tag.ref))}">${e(draft.text.slice(tag.start,tag.end))}<small>${e(refTitle(tag.ref))} · ${tag.mode==='auto'?'авто':'вручную'}</small></button>`;at=tag.end;}
  html+=plain(draft.text.slice(at),at);container.innerHTML=html;
 }
 function impact(){
  const base=history.find(v=>v.revision===current.reviewedRevision),i=flowImpact([base,draft],state.entities,atlas);
  app.querySelector('#flow-impact').innerHTML=`<p>Это кандидаты для проверки по коду, а не обещание автоматической переделки всех экранов.</p><div class="flow-links">${i.screenIds.map(id=>`<a href="/ui-atlas#${e(id)}">${e(atlas.screens.find(s=>s.id===id)?.title||id)}</a>`).join('')}${i.componentIds.map(id=>`<a href="/ui-atlas/components#${e(id)}">${e(atlas.components.find(c=>c.id===id)?.title||id)}</a>`).join('')}</div>${i.outside.length?`<p>За границей снимков: ${i.outside.map(e).join('; ')}</p>`:''}`;
 }
 function diffHTML(before,after){
  const d=flowDiff(before,after);if(!Object.keys(d).length)return '<p>Изменений нет.</p>';
  let html='';if(d.title)html+=`<p>Название: <del>${e(d.title.before)}</del> → <ins>${e(d.title.after)}</ins></p>`;
  if(d.text){const a=String(d.text.before||''),b=String(d.text.after||'');let start=0,end=0;while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;while(end<Math.min(a.length-start,b.length-start)&&a[a.length-1-end]===b[b.length-1-end])end++;html+=`<p class="text-diff">${e(a.slice(0,start))}<del>${e(a.slice(start,a.length-end))}</del><ins>${e(b.slice(start,b.length-end))}</ins>${e(end?b.slice(-end):'')}</p>`;}
  if(d.tags){const tags=(v,text)=>(v||[]).map(t=>`«${text?.slice(t.start,t.end)||''}» → ${refTitle(t.ref)} [${t.ref||'none'}; ${t.mode}]`).join('\n');html+=`<details><summary>Изменения ссылок на объекты</summary><div class="tag-diff"><div><strong>До</strong><pre>${e(tags(d.tags.before,before?.text))}</pre></div><div><strong>После</strong><pre>${e(tags(d.tags.after,after.text))}</pre></div></div></details>`;}
  if(d.actionIds)html+=`<p>Действия: ${e((d.actionIds.before||[]).join(', '))} → ${e(d.actionIds.after.join(', '))}</p>`;return html;
 }
 function renderHistory(){
  app.querySelector('#flow-versions').innerHTML=history.map(v=>`<button type="button" data-version="${v.revision}" aria-pressed="${v.revision===(pickedVersion||current.revision)}">v${v.revision} · ${e(new Date(v.createdAt).toLocaleString('ru-RU'))}</button>`).join('');
  const v=history.find(v=>v.revision===(pickedVersion||current.revision)),before=history.find(x=>x.revision===v.revision-1);
  app.querySelector('#flow-version-detail').innerHTML=`<p>${e(v.note)}</p>${before?diffHTML(before,v):'<p>Исходная версия пилота.</p>'}<details><summary>Полный текст v${v.revision}</summary><h3>${e(v.title)}</h3><p class="version-text">${e(v.text)}</p><pre>${e(JSON.stringify(v.tags,null,2))}</pre></details>`;
 }
 function renderReview(request){
  const r=request||state.reviews.find(r=>r.flowId===current.id&&r.targetRevision===current.revision);const n=app.querySelector('#review-result');
  if(!r){n.innerHTML='';return;}
  n.innerHTML=`<p>${r.status==='done'?'Разобрано: '+e(r.completionNote):'Задача сохранена. Скопируйте текст в Codex; автоматический запуск не выполняется.'} · v${r.baseRevision} → v${r.targetRevision}</p><label>Текст задачи<textarea id="review-prompt" readonly rows="5"></textarea></label><div class="flow-toolbar"><button type="button" data-copy-review>Копировать задачу</button><button type="button" data-download-review>Скачать задачу и диф</button></div><details><summary>Сохранённые данные для разбора</summary><pre>${e(JSON.stringify(r,null,2))}</pre></details>`;n.querySelector('#review-prompt').value=r.prompt;n.dataset.request=r.id;
 }
 function picker(start,end){
  if(start===end)return message('Выделите слово или фразу в поле текста.',true);
  range={start,end};const tag=draft.tags.find(t=>t.start===start&&t.end===end),ent=entity(tag?.ref);
  app.querySelector('#tag-picker').hidden=false;app.querySelector('#tag-heading').textContent='«'+draft.text.slice(start,end)+'»';
  app.querySelector('#tag-details').innerHTML=ent?`<p><strong>${e(ent.kind)} · ${e(ent.title)}</strong> <code>${e(ent.id)}</code></p><p>${e(ent.description)}</p><div class="flow-links">${(ent.contractRefs||[]).map(id=>`<a href="/ui-atlas/contracts#${e(id)}">Контракт: ${e(id)}</a>`).join('')}</div><p>Хранение: ${e(ent.storage)}</p><p>Поля: ${ent.fields.map(e).join(', ')||'Нет собственных полей'}</p><ul>${ent.evidence.map(v=>`<li><code>${e(v.file)} · ${e(v.symbol)}</code></li>`).join('')}</ul>${ent.outside?`<p>${e(ent.outside)}</p>`:''}<div class="flow-links">${ent.actionIds.map(linkAction).join('')}</div>`:'<p>У слова пока нет привязки. Выберите конкретный объект, поле, экран, компонент или действие.</p>';
  app.querySelector('#tag-search').value='';options('');
 }
 function options(search){
  const found=state.entities.filter(v=>(v.title+' '+v.kind+' '+v.id+' '+v.aliases.join(' ')).toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
  app.querySelector('#tag-options').innerHTML=`<button type="button" data-tag-ref="">Без тега · не отмечать автоматически</button>${found.map(v=>`<button type="button" data-tag-ref="${e(v.id)}"><strong>${e(v.title)}</strong><small>${e(v.kind)} · ${e(v.id)}</small></button>`).join('')}${!found.length?'<p>Объект не найден.</p>':''}`;
 }
 app.addEventListener('change',async event=>{if(event.target.id!=='flow-choice')return;if(busy){event.target.value=current.id;return;}if(dirty){event.target.value=current.id;return message('Сохраните версию или отмените правки перед переходом к другому сценарию.',true);}try{await select(event.target.value);}catch(error){message(error.message,true);}});
 app.addEventListener('input',event=>{
  if(event.target.id==='tag-search')return options(event.target.value);
  if(event.target.id==='flow-title')draft.title=event.target.value;
  else if(event.target.id==='flow-text'){const text=event.target.value,rebased=rebaseManual(draft.text,text,draft.tags);draft.text=text;draft.tags=autoTags(text,state.entities,rebased.tags);range=null;app.querySelector('#tag-picker').hidden=true;if(rebased.dropped)message('Ручной тег затронут изменением текста и снят. Проверьте новую разметку.',true);}
  else return;
  dirty=Object.keys(flowDiff(current,draft)).length>0;refresh();
 });
 app.addEventListener('click',async event=>{
  const n=event.target.closest('button');if(!n||busy)return;
  try{
   if(n.dataset.flow){if(dirty)return message('Сохраните версию или отмените правки перед переходом к другому сценарию.',true);await select(n.dataset.flow);}
   if(n.hasAttribute('data-word-mode')){wordMode=!wordMode;n.setAttribute('aria-pressed',String(wordMode));annotate();}
   if(n.dataset.range){const [start,end]=n.dataset.range.split(':').map(Number);picker(start,end);}
   if(n.hasAttribute('data-tag-selection')){const t=app.querySelector('#flow-text');picker(t.selectionStart,t.selectionEnd);}
   if(n.hasAttribute('data-close-picker')){app.querySelector('#tag-picker').hidden=true;range=null;}
   if(n.hasAttribute('data-tag-ref')&&range){const manual=draft.tags.filter(t=>t.mode==='manual'&&!(t.start<range.end&&t.end>range.start));manual.push({...range,ref:n.dataset.tagRef||null,mode:'manual'});draft.tags=autoTags(draft.text,state.entities,manual);dirty=Object.keys(flowDiff(current,draft)).length>0;refresh();picker(range.start,range.end);message('Тег изменён. Сохраните версию.');}
   if(n.hasAttribute('data-discard-flow'))await select(current.id);
   if(n.hasAttribute('data-save-flow')){lock();const saved=await api('/'+current.id,{...draft,note:app.querySelector('#flow-note').value},'PUT');state=await api();await select(saved.id);message('Версия '+saved.revision+' сохранена. Интерфейс приложения пока не изменён.');}
   if(n.dataset.version){pickedVersion=Number(n.dataset.version);renderHistory();}
   if(n.hasAttribute('data-request-review')){if(dirty)return message('Сначала сохраните версию.',true);lock();const r=await api('/'+current.id+'/review',{revision:current.revision},'POST');state=await api();renderReview(r);message('Задача для Codex сохранена вместе с дифом.');}
   if(n.hasAttribute('data-copy-review')){const t=app.querySelector('#review-prompt');try{await navigator.clipboard.writeText(t.value);message('Текст задачи скопирован.');}catch{t.focus();t.select();message('Текст выделен — скопируйте его системной командой.');}}
   if(n.hasAttribute('data-download-review')){const r=state.reviews.find(r=>r.id===app.querySelector('#review-result').dataset.request),url=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=current.id+'-v'+current.revision+'-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }catch(error){message(error.message,true);}finally{busy=false;unlock();refresh();}
 });
 window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
 await select(decodeURIComponent(location.hash.slice(1)));
}
