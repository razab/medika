import {DatabaseSync} from 'node:sqlite';
import {readFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {assert} from './domain.mjs';
import {autoTags,flowDiff,flowImpact,flowEntities} from '../../skills/project-ui-atlas/assets/flow-model.js';

export function openAtlasFlows(dataDir,seed,manifest){
 const atlas=()=>JSON.parse(readFileSync(manifest,'utf8')),entities=flowEntities(seed.entities,atlas());
 const file=join(dataDir,'ui-atlas.sqlite'),db=new DatabaseSync(file);chmodSync(file,0o600);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS versions(flow_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(flow_id,revision));
 CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,data TEXT NOT NULL);`);
 const insert=db.prepare('INSERT INTO versions VALUES(?,?,?)');
 for(const f of seed.flows)if(!db.prepare('SELECT 1 FROM versions WHERE flow_id=?').get(f.id)){
  const v={...f,revision:1,tags:autoTags(f.text,entities),createdAt:new Date().toISOString(),diff:{},note:'Исходное описание пилота'};insert.run(f.id,1,JSON.stringify(v));
 }
 const history=id=>db.prepare('SELECT data FROM versions WHERE flow_id=? ORDER BY revision DESC').all(id).map(r=>JSON.parse(r.data));
 const latest=id=>{const v=history(id)[0];assert(v,'Сценарий не найден',404);return v;};
 const reviews=()=>db.prepare('SELECT data FROM reviews ORDER BY rowid DESC').all().map(r=>JSON.parse(r.data));
 const baseline=id=>Math.max(1,...reviews().filter(r=>r.flowId===id&&r.status==='done').map(r=>r.targetRevision));
 function validate(input){
  assert(typeof input.title==='string'&&input.title.trim()&&input.title.length<=200,'Заголовок: от 1 до 200 символов');
  assert(typeof input.text==='string'&&input.text.trim()&&input.text.length<=20000,'Текст: от 1 до 20000 символов');
  assert(Array.isArray(input.tags)&&input.tags.length<=500,'Некорректные теги');
  let previous=0;
  for(const t of input.tags){assert(t&&Number.isInteger(t.start)&&Number.isInteger(t.end)&&t.start>=previous&&t.end>t.start&&t.end<=input.text.length,'Теги перекрываются или выходят за текст');assert(t.ref===null||entities.some(e=>e.id===t.ref),'Неизвестный объект тега');assert(['auto','manual'].includes(t.mode),'Некорректный источник тега');previous=t.end;}
  assert(Array.isArray(input.actionIds)&&input.actionIds.length<=50&&input.actionIds.every(id=>atlas().actions.some(a=>a.id===id)),'Неизвестное действие');
  assert(input.note===undefined||typeof input.note==='string'&&input.note.length<=1200,'Комментарий слишком длинный');
  return {title:input.title.trim(),text:input.text,tags:autoTags(input.text,entities,input.tags.filter(t=>t.mode==='manual').map(({start,end,ref})=>({start,end,ref,mode:'manual'}))),actionIds:[...new Set(input.actionIds)]};
 }
 function save(id,input){
  db.exec('BEGIN IMMEDIATE');try{
   const old=latest(id),draft=validate(input),diff=flowDiff(old,draft);
   if(!Object.keys(diff).length){db.exec('COMMIT');return old;}
   assert(Number.isInteger(input.revision)&&input.revision===old.revision,'Сценарий уже изменён в другой вкладке. Скопируйте свой текст и обновите страницу; правка не перезаписана.',409);
   const v={...draft,id,revision:old.revision+1,createdAt:new Date().toISOString(),note:input.note||'',diff};insert.run(id,v.revision,JSON.stringify(v));db.exec('COMMIT');return v;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 function packet(id){
  const after=latest(id),baseRevision=baseline(id),before=history(id).find(v=>v.revision===baseRevision),impact=flowImpact([before,after],entities,atlas());
  return {flowId:id,baseRevision,targetRevision:after.revision,before,after,diff:flowDiff(before,after),impact,entities:entities.filter(e=>impact.refs.includes(e.id)),manifestRevision:atlas().revision,manifestSources:atlas().sources};
 }
 function request(id,input){
  const p=packet(id);assert(input.revision===p.targetRevision,'Перед созданием задачи сохраните и обновите сценарий.',409);assert(Object.keys(p.diff).length,'Нет изменений относительно разобранной версии');
  const old=reviews().find(r=>r.flowId===id&&r.targetRevision===p.targetRevision&&r.baseRevision===p.baseRevision&&r.status==='pending');if(old)return old;
  const r={id:randomUUID(),flowId:id,baseRevision:p.baseRevision,targetRevision:p.targetRevision,status:'pending',createdAt:new Date().toISOString(),packet:p,prompt:`Используй $project-ui-atlas. Разбери локальную задачу ${id}, версии ${p.baseRevision} → ${p.targetRevision}. Прочитай сохранённый packet, diff и impact через node site/scripts/atlas-flows.mjs pending. Сначала проверь затронутый код; изменение сценария не доказывает изменение интерфейса. Внеси правки в согласованном объёме, проверь синтетический путь, обнови атлас и USER-FLOWS.md. После выполненной проверки отметь задачу: node site/scripts/atlas-flows.mjs done ${'REQUEST_ID'} --note 'что изменено и проверено'.`};r.prompt=r.prompt.replace('REQUEST_ID',r.id);
  db.prepare('INSERT INTO reviews VALUES(?,?)').run(r.id,JSON.stringify(r));return r;
 }
 function complete(id,note){const r=reviews().find(r=>r.id===id);assert(r,'Задача не найдена',404);assert(typeof note==='string'&&note.trim()&&note.length<=4000,'Нужно описать выполненные изменения и проверки');const next={...r,status:'done',completedAt:new Date().toISOString(),completionNote:note};db.prepare('UPDATE reviews SET data=? WHERE id=?').run(JSON.stringify(next),id);return next;}
 return {list:()=>({scope:seed.scope,entities:entities,flows:seed.flows.map(f=>({...latest(f.id),reviewedRevision:baseline(f.id)})),reviews:reviews()}),history,save,packet,request,complete,reviews,close:()=>db.close()};
}
