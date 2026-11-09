import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {designSnapshot} from '../lib/design-snapshot.mjs';
const origin='http://127.0.0.1:4382',timeZone='Europe/Chisinau';
const session=await fetch(origin+'/api/session');if(!session.ok)throw Error('Медика недоступна');const {token}=await session.json();
async function get(path){const r=await fetch(origin+'/api'+path,{headers:{'X-Medika-Token':token}});if(!r.ok)throw Error('Не удалось прочитать данные для копии');return r.json();}
const state=await get('/state'),copiedAt=new Date(),last=[...(state.activities||[]),...(state.temperatures||[]),...(state.events||[])].filter(r=>r.status!=='void'&&Number.isFinite(Date.parse(r.occurredAt))&&Date.parse(r.occurredAt)<=Number(copiedAt)).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt))[0];
// Freeze the last populated day so the design review includes actual history.
const now=last?new Date(last.occurredAt):copiedAt,date=now.toLocaleDateString('sv-SE',{timeZone}),schedule=await get('/schedule?date='+date),snapshot=designSnapshot(state,schedule,{date,now,copiedAt,timeZone});
const directory=fileURLToPath(new URL('../data/design-study/',import.meta.url));await mkdir(directory,{recursive:true,mode:0o700});await writeFile(directory+'a1-family.json',JSON.stringify(snapshot,null,2),{mode:0o600});
console.log(JSON.stringify({saved:'site/data/design-study/a1-family.json',people:snapshot.model.cards.length,history:snapshot.model.history.length,contextDate:date}));
