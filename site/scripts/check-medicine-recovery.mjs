import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parseWithCodex,parserRevision} from '../lib/codex-parser.mjs';
const recordedAt=new Date(Date.now()-10000).toISOString(),state={people:[{id:'d',name:'Даня'}],prescriptions:[{id:'r',personId:'d',name:'Омепразол'}]};
const cases=[
  {id:'patient-context',text:'Даня получил капсулу омепрозола 20 мг пять минут назад',check:d=>{assert.equal(d.name,'Омепразол');assert.equal(d.relatedRxId,'r');assert.equal(d.amount,'1');assert.equal(d.strength,'20 мг');assert.equal(d.canAutoRecord,true);}},
  {id:'clear-other-medicine',text:'Даня получил таблетку ибупрофена 200 мг пять минут назад',check:d=>{assert.match(d.name,/ибупрофен/iu);assert.equal(d.relatedRxId,'');assert.equal(d.amount,'1');assert.equal(d.strength,'200 мг');assert.equal(d.canAutoRecord,true);}},
  {id:'absent-name',text:'Даня получил какую-то таблетку пять минут назад',check:d=>{assert.equal(d.canAutoRecord,false);assert.equal(d.name,'');}}
];
const results=[];
try{
 for(const c of cases){const draft=await parseWithCodex(state,{text:c.text,recordedAt,timeZone:'Europe/Chisinau'});c.check(draft);results.push({caseId:c.id,draft});console.log('PASS '+c.id);}
 await writeFile(fileURLToPath(new URL('../../reports/medicine-recovery-cases.json',import.meta.url)),JSON.stringify({status:'PASS',checkedAt:new Date().toISOString(),parserRevision,syntheticDataOnly:true,model:'gpt-6.1-terra',results},null,2)+'\n');
}catch(error){console.error(error);process.exitCode=1;}
