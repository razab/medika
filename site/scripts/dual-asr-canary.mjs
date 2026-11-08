import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createApp} from '../server.mjs';
import {parseWithCodex,codexModel,parserRevision} from '../lib/codex-parser.mjs';
const exec=promisify(execFile),dir=await mkdtemp(join(tmpdir(),'medika-dual-canary-')),port=14388,origin='http://127.0.0.1:'+port,reports=join(dirname(fileURLToPath(import.meta.url)),'../../reports');
let app,token;const report={syntheticDataOnly:true,model:codexModel,parserRevision,checks:[]};
async function start(dataDir){app=await createApp({dataDir,port,entryParser:parseWithCodex});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));token=(await(await fetch(origin+'/api/session')).json()).token;}
async function api(path,body){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Medika-Token':token},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
try{
 await start(join(dir,'data'));const people=[];for(const name of ['Даня','Алиса','Папа','Мама'])people.push(await api('/people',{name}));
 await exec('/usr/bin/say',['-v','Milena','-o',join(dir,'speech.aiff'),'Даня, две минуты назад температура тридцать восемь и два.']);
 const recordedAt=new Date().toISOString(),transcription=await api('/transcribe',{audio:(await readFile(join(dir,'speech.aiff'))).toString('base64'),language:'ru'});assert.deepEqual(transcription.transcripts.map(t=>t.model),['small','medium']);assert.ok(transcription.transcripts.every(t=>t.text));report.transcription=transcription;report.checks.push('Одна запись → настоящий Whisper Small и Whisper Medium последовательно');
 const input={text:transcription.text,recordedAt,timeZone:'Europe/Chisinau',clientKey:'dual-asr-canary-event'},answer=await api('/record-entry',input);assert.ok(answer.record,JSON.stringify(answer));assert.equal(answer.record.personId,people[0].id);assert.equal(answer.record.celsius,38.2);assert.equal(Date.parse(answer.record.occurredAt),Date.parse(recordedAt)-120000);assert.equal(answer.record.sourceText,transcription.text);assert.equal((await api('/record-entry',input)).record.id,answer.record.id);assert.equal((await api('/state')).activities.length,1);report.checks.push('Один Sol → Даня, 38,2 °C, две минуты назад; обе исходные версии сохранены; повтор без дубля');
 const backup=await api('/backup');await writeFile(join(dir,'durable-backup.json'),JSON.stringify(backup));await app.close();await start(join(dir,'data'));assert.equal((await api('/state')).activities[0].sourceText,transcription.text);await app.close();await start(join(dir,'restored'));assert.equal((await api('/restore',JSON.parse(await readFile(join(dir,'durable-backup.json'),'utf8')))).inserted,5);assert.equal((await api('/restore',backup)).inserted,0);assert.equal((await api('/state')).activities[0].sourceText,transcription.text);report.checks.push('Перезапуск и backup/restore сохраняют обе расшифровки без дублей');report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.stack;process.exitCode=1;}finally{await app?.close();await rm(dir,{recursive:true,force:true});await writeFile(join(reports,'dual-asr-canary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}
