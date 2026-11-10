import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.mjs';
import {encodeWav} from '../public/voice-capture.js';
import {parseEntry, namedPeople} from '../lib/entry-parser.mjs';
import {createVoiceLab} from '../lib/voice-lab.mjs';
import {InputError} from '../lib/domain.mjs';

test('Тест голоса: единый WAV, кэш, границы, приватность, ошибка, возобновление и изоляция пациентов',async()=>{
  const data=await mkdtemp(join(tmpdir(),'medika-voice-lab-')),port=14394,origin=`http://127.0.0.1:${port}`;let app,token,asrCalls=0,parseCalls=0;
  const voiceLabOptions={context:()=>[{name:'Даня',medicines:['ТестПрепарат']}],availability:async()=>({medium:true,small:true,codex:true}),transcribe:async()=>{asrCalls++;return {text:'Даня, две минуты назад температура 38,2'};},parse:async(state,input,{model})=>{parseCalls++;assert.deepEqual(state.prescriptions,[{personId:'lab-danya',name:'ТестПрепарат'}]);assert.deepEqual(state.people.map(p=>p.id),['lab-danya','lab-alice','lab-mom','lab-dad']);if(model==='gpt-6.1-sol')throw new InputError('Лимит тестового провайдера',429);return parseEntry(state,input);}};
  async function start(){app=await createApp({dataDir:data,port,voiceLabOptions});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));token=(await(await fetch(origin+'/api/session')).json()).token;}
  async function call(path,body,status=200,method=body?'POST':'GET',extra={}){const response=await fetch(origin+path,{method,headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
  try{
    await start();const before=await call('/api/backup');
    const floats=new Float32Array(16000);for(let i=0;i<floats.length;i++)floats[i]=.2*Math.sin(i*.1);const bytes=Buffer.from(await encodeWav([floats],16000).arrayBuffer()),audio=bytes.toString('base64'),input={audio,language:'ru',phraseId:'temperature',capturedAt:new Date(Date.now()-5000).toISOString(),timeZone:'Europe/Chisinau',clientKey:'voice-lab-unique-0001'};
    await call('/api/voice-lab/recordings',{...input,language:'fr'},400);await call('/api/voice-lab/recordings',{...input,audio:'!'},413);await call('/api/voice-lab/recordings',{...input,capturedAt:new Date(Date.now()+600000).toISOString()},400);
    const record=await call('/api/voice-lab/recordings',input,201);assert.equal((await call('/api/voice-lab/recordings',input,201)).id,record.id);await call('/api/voice-lab/recordings',{...input,phraseId:'tablet'},409);
    const media='/api/voice-lab/recordings/'+record.id+'/audio';assert.equal((await fetch(origin+media,{headers:{'X-Medika-Token':token}})).status,403);
    const cookie={Cookie:'medika_session='+token},full=await fetch(origin+media,{headers:cookie}),wav=Buffer.from(await full.arrayBuffer());assert.equal(wav.toString('ascii',0,4),'RIFF');
    const part=await fetch(origin+media,{headers:{...cookie,Range:'bytes=0-1'}});assert.equal(part.status,206);assert.equal((await part.arrayBuffer()).byteLength,2);assert.equal((await fetch(origin+media,{headers:{...cookie,Range:'bytes=9999999-'}})).status,416);
    assert.equal((await fetch(origin+media,{headers:{...cookie,Origin:'https://foreign.example'}})).status,403);assert.equal((await fetch(origin+'/voice-lab',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,200);
    const run='/api/voice-lab/recordings/'+record.id+'/run',first=await call(run,{variantId:'medium-terra'});assert.equal(first.status,'complete');assert.equal(first.score.passed,true);assert.equal(first.audioSha256,record.audioSha256);await call(run,{variantId:'medium-terra'});assert.equal(asrCalls,1);assert.equal(parseCalls,1);
    await call(run,{variantId:'base-terra'},400);await call(run,{variantId:'base-sol'},400);assert.equal(asrCalls,1);
    await call(run,{variantId:'small-terra'});assert.equal(asrCalls,2);const fail=await call(run,{variantId:'medium-sol'});assert.equal(fail.status,'failed');assert.equal(fail.errorStatus,429);assert.equal(asrCalls,2);
    const verdict='/api/voice-lab/recordings/'+record.id+'/verdict';await call(verdict,{variantId:'medium-terra',verdict:'correct'});await call(verdict,{variantId:'medium-terra',verdict:'invalid'},400);await call(run,{variantId:'unknown'},400);
    const storedPath=join(data,'voice-lab',record.id+'.json'),stored=JSON.parse(await readFile(storedPath,'utf8'));stored.results['medium-terra'].analysisKey='old-parser';stored.results['small-luna']={status:'running',variantId:'small-luna'};await writeFile(storedPath,JSON.stringify(stored));
    await app.close();await start();const saved=(await call('/api/voice-lab')).recordings[0];assert.equal(saved.results['medium-terra'].verdict,'correct');assert.equal(saved.results['small-luna'].status,'interrupted');const complete=await call(run,{variantId:'small-luna'});assert.equal(complete.status,'complete');assert.equal(asrCalls,2);
    const attempts=parseCalls;const updated=await call(run,{variantId:'medium-terra'});assert.equal(parseCalls,attempts+1);assert.equal(asrCalls,2);assert.notEqual(updated.analysisKey,'old-parser');assert.equal(updated.parserRevision,'dual-asr-sol-library-v4');const revised=JSON.parse(await readFile(storedPath,'utf8'));assert.equal(revised.resultHistory.filter(r=>r.variantId==='medium-terra').length,1);assert.equal(revised.resultHistory.find(r=>r.variantId==='medium-terra').verdict,'correct');await call(run,{variantId:'medium-terra'});assert.equal(parseCalls,attempts+1);
    const after=await call('/api/backup');for(const key of ['people','documents','prescriptions','events','temperatures','activities','audit'])assert.deepEqual(after[key],before[key]);
    await call('/api/voice-lab/recordings/'+record.id,undefined,200,'DELETE');assert.equal((await call('/api/voice-lab')).recordings.length,0);assert.equal((await fetch(origin+media,{headers:{Cookie:'medika_session='+token}})).status,404);
  }finally{await app?.close();await rm(data,{recursive:true,force:true});}
});


test('Две расшифровки → один Sol: общий WAV, частичный кэш, возобновление и недоступная модель',async()=>{
 const data=await mkdtemp(join(tmpdir(),'medika-dual-lab-'));let asr=[],parses=0,fail=true;
 try{
  const wav=Buffer.from(await encodeWav([new Float32Array(16000).fill(.2)],16000).arrayBuffer());
  const options={prepare:async()=>({bytes:wav,duration:1,language:'ru'}),availability:async()=>({small:true,medium:true,codex:true}),transcribe:async(bytes,language,dir,model)=>{assert.ok(bytes.equals(wav));asr.push(model);if(model==='medium'&&fail){fail=false;throw new InputError('Тестовая остановка',503);}return {text:model==='small'?'Даня получил свечку':'Да нет, парацетамол 125 мг'};},parse:async(state,input,{model})=>{parses++;assert.equal(model,'gpt-6.1-sol');assert.match(input.text,/Whisper Small:\nДаня/);assert.match(input.text,/Whisper Medium:\nДа нет/);return {personId:'lab-danya',kind:'medication',name:'Парацетамол',amount:'1',unit:'свеча',strength:'125 мг',occurredAt:input.recordedAt,timeZone:input.timeZone,sourceText:input.text,canAutoRecord:true,notes:[]};}};
  let lab=await createVoiceLab(data,options);const record=await lab.add({audio:wav.toString('base64'),language:'ru',phraseId:'custom',capturedAt:new Date().toISOString(),timeZone:'Europe/Chisinau',clientKey:'dual-lab-fixture'});
  assert.equal((await lab.run(record.id,'dual-sol')).status,'failed');assert.deepEqual(asr,['small','medium']);assert.equal(parses,0);
  lab=await createVoiceLab(data,options);const result=await lab.run(record.id,'dual-sol');assert.equal(result.status,'complete');assert.deepEqual(asr,['small','medium','medium']);assert.equal(parses,1);assert.equal(result.audioSha256,record.audioSha256);assert.equal((await lab.run(record.id,'dual-sol')).transcript,result.transcript);assert.equal(parses,1);assert.equal(Object.keys((await lab.state()).recordings[0].transcripts).length,2);
  lab=await createVoiceLab(data,{...options,availability:async()=>({small:true,medium:false,codex:true})});assert.equal((await lab.state()).variants.find(v=>v.id==='dual-sol').ready,false);
 }finally{await rm(data,{recursive:true,force:true});}
});
