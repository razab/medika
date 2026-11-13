// Shared UTF-16 offsets match textarea/Selection offsets in the browser.
export function autoTags(text,entities,manual=[]){
 const tags=manual.filter(t=>t.mode==='manual'&&t.start>=0&&t.end<=text.length&&t.end>t.start).map(t=>({...t}));
 const candidates=[];
 for(const entity of entities)for(const alias of entity.aliases||[]){let at=0;const lower=text.toLocaleLowerCase('ru');while((at=lower.indexOf(alias.toLocaleLowerCase('ru'),at))!==-1){const end=at+alias.length;if(!/[\p{L}\p{N}_]/u.test(text[at-1]||'')&&!/[\p{L}\p{N}_]/u.test(text[end]||''))candidates.push({start:at,end,ref:entity.id,mode:'auto'});at=end;}}
 candidates.sort((a,b)=>(b.end-b.start)-(a.end-a.start)||a.start-b.start);
 for(const tag of candidates)if(!tags.some(t=>t.start<tag.end&&t.end>tag.start))tags.push(tag);
 return tags.sort((a,b)=>a.start-b.start);
}
export function rebaseManual(before,after,tags){
 if(before===after)return {tags:tags.filter(t=>t.mode==='manual'),dropped:0};
 let start=0,end=0;while(start<Math.min(before.length,after.length)&&before[start]===after[start])start++;
 while(end<Math.min(before.length-start,after.length-start)&&before[before.length-1-end]===after[after.length-1-end])end++;
 const result=[];let dropped=0;
 for(const t of tags.filter(t=>t.mode==='manual'))if(t.end<=start)result.push(t);else if(t.start>=before.length-end)result.push({...t,start:t.start+after.length-before.length,end:t.end+after.length-before.length});else dropped++;
 return {tags:result,dropped};
}
export function flowDiff(before,after){
 const result={};
 for(const key of ['title','text','tags','actionIds'])if(JSON.stringify(before?.[key])!==JSON.stringify(after?.[key]))result[key]={before:before?.[key]??null,after:after?.[key]??null};
 return result;
}
export function flowImpact(versions,entities,atlas){
 const refs=[...new Set(versions.flatMap(v=>(v?.tags||[]).map(t=>t.ref).filter(Boolean)))];
 const selected=entities.filter(e=>refs.includes(e.id));
 const actionIds=[...new Set([...versions.flatMap(v=>v?.actionIds||[]),...selected.flatMap(e=>e.actionIds||[])])];
 const actions=atlas.actions.filter(a=>actionIds.includes(a.id));
 const screenIds=[...new Set([...selected.flatMap(e=>e.screenIds||[]),...actions.flatMap(a=>[a.from,a.to,...a.affects]).filter(Boolean)])];
 const componentIds=[...new Set([...selected.flatMap(e=>e.componentIds||[]),...atlas.components.filter(c=>c.actionIds.some(id=>actionIds.includes(id))).map(c=>c.id)])];
 return {refs,actionIds,screenIds,componentIds,outside:[...new Set([...selected.map(e=>e.outside).filter(Boolean),...actions.map(a=>a.outside).filter(Boolean)])]};
}

// UI references come from the same manifest as the map; do not duplicate them in seeds.
export function flowEntities(dataObjects,atlas){
 const screens=atlas.screens.map(s=>({id:'screen:'+s.id,kind:'Экран',title:s.title,aliases:[s.title.toLocaleLowerCase('ru')],description:s.description,storage:'Представление, не объект хранения',fields:[],evidence:s.evidence,screenIds:[s.id],componentIds:s.componentIds,actionIds:[]}));
 const components=atlas.components.map(c=>({id:'component:'+c.id,kind:'Компонент',title:c.title,aliases:[],description:c.description,storage:'Представление данных',fields:c.fields.map(f=>f.name),evidence:c.evidence,screenIds:c.usedOn,componentIds:[c.id],actionIds:c.actionIds}));
 const actions=atlas.actions.map(a=>({id:'action:'+a.id,kind:'Действие',title:a.label,aliases:[],description:a.result,storage:a.storage.map(s=>s.name+' · '+s.operation).join('; ')||'Не изменяется',fields:a.fields.map(f=>f.name),evidence:a.evidence,screenIds:[a.from],componentIds:[],actionIds:[a.id],...(a.outside?{outside:a.outside}:{})}));
 return [...dataObjects,...screens,...components,...actions];
}
