import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {encodeWav} from '../public/voice-capture.js';
import {parseWithCodex,codexModel} from '../lib/codex-parser.mjs';
const exec=promisify(execFile),site=join(dirname(fileURLToPath(import.meta.url)),'..'),data=join(site,'data/voice-comparison'),reportPath=join(site,'../reports/voice-comparison-small-medium.json'),whisper=join(site,'tools/whisper.cpp/build/bin/whisper-cli');
const cases=[
  {id:'temperature',text:'Даня, две минуты назад температура тридцать восемь и два.',expected:{kind:'temperature',celsius:'38.2',secondsAgo:120}},
  {id:'tablet',text:'Даня получил половину таблетки парацетамола двести пятьдесят миллиграмм пять минут назад.',expected:{kind:'medication',amount:'0.5',unit:'табл.',strengthNumber:'250',secondsAgo:300}},
  {id:'suppository',text:'Дане поставили одну свечку парацетамола сто двадцать пять миллиграмм десять минут назад.',expected:{kind:'medication',amount:'1',unit:'свеча',strengthNumber:'125',secondsAgo:600}},
  {id:'retching',text:'Даня, позывы к рвоте три минуты назад.',expected:{kind:'retching',secondsAgo:180}},
  {id:'temperature-noisy',base:'temperature',snr:8,gain:0.18},
  {id:'tablet-noisy',base:'tablet',snr:12,gain:0.12}
];
const state={people:[{id:'synthetic-danya',name:'Даня'}],prescriptions:[]},modelNames=['small','medium'];
const pin=JSON.parse(await readFile(join(site,'voice-engine.json'),'utf8')),models=Object.fromEntries(modelNames.map(name=>[name,{path:join(site,'data/models',pin.models[name].file),sha:pin.models[name].sha256}]));
const hash=b=>createHash('sha256').update(b).digest('hex');
await mkdir(data,{recursive:true,mode:0o700});
for(const model of Object.values(models))assert.equal(hash(await readFile(model.path)),model.sha,'Model SHA256');
function samples(wav){let offset=12;while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){const floats=new Float32Array(size/2);for(let i=0;i<floats.length;i++)floats[i]=wav.readInt16LE(offset+8+2*i)/32768;return floats;}offset+=8+size+(size%2);}throw Error('No WAV data');}
async function fixture(c){
  const path=join(data,c.id+'.wav');try{await access(path);return {path,sha:hash(await readFile(path))};}catch{}
  if(c.base){
    const original=cases.find(x=>x.id===c.base),base=await fixture(original),pcm=samples(await readFile(base.path));let energy=0;for(const x of pcm)energy+=x*x;const noise=Math.sqrt(energy/pcm.length)*c.gain/Math.pow(10,c.snr/20)*Math.sqrt(3);let seed=42;
    for(let i=0;i<pcm.length;i++){seed=(Math.imul(1664525,seed)+1013904223)>>>0;pcm[i]=pcm[i]*c.gain+(seed/4294967296*2-1)*noise;}
    await writeFile(path,Buffer.from(await encodeWav([pcm],16000).arrayBuffer()));
  }else{
    await exec('/usr/bin/say',['-v','Milena','-o',join(data,c.id+'.aiff'),c.text]);await exec('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',join(data,c.id+'.aiff'),path]);
  }
  return {path,sha:hash(await readFile(path))};
}
let report;try{report=JSON.parse(await readFile(reportPath,'utf8'));}catch{report={version:1,status:'RUNNING',syntheticDataOnly:true,tts:'macOS Milena ru-RU',semanticModel:codexModel,reasoning:'low',results:[]};}
assert.equal(report.semanticModel,codexModel);assert.equal(report.syntheticDataOnly,true);
async function checkpoint(){report.updatedAt=new Date().toISOString();await writeFile(reportPath+'.partial',JSON.stringify(report,null,2));await rename(reportPath+'.partial',reportPath);}
const chosen=process.argv.includes('--canary')?cases.slice(0,1):cases;
for(const c of chosen){
  const audio=await fixture(c),expected=c.expected||cases.find(x=>x.id===c.base).expected;
  for(const name of modelNames){
    if(report.results.some(r=>r.caseId===c.id&&r.asr===name&&r.audioSha256===audio.sha)){console.log('RESUME '+c.id+' '+name);continue;}
    const out=join(data,c.id+'-'+name),started=performance.now();
    await exec(whisper,['-m',models[name].path,'-f',audio.path,'-l','ru','-t','4','-oj','-of',out,'-np'],{timeout:90000,maxBuffer:2*1024*1024});
    const asrMs=Math.round(performance.now()-started),raw=JSON.parse(await readFile(out+'.json','utf8')),text=raw.transcription.map(s=>s.text).join(' ').trim(),recordedAt=new Date().toISOString(),semanticStart=performance.now();
    const draft=await parseWithCodex(state,{text,recordedAt,timeZone:'Europe/Chisinau'}),semanticMs=Math.round(performance.now()-semanticStart),secondsAgo=draft.occurredAt?(Date.parse(recordedAt)-Date.parse(draft.occurredAt))/1000:null;
    const fields={person:draft.personId==='synthetic-danya',kind:draft.kind===expected.kind,time:secondsAgo===expected.secondsAgo,autoRecord:draft.canAutoRecord};
    for(const key of ['celsius','amount','unit'])if(expected[key]!==undefined)fields[key]=draft[key]===expected[key];
    if(expected.strengthNumber)fields.strength=draft.strength.replace(',','.').includes(expected.strengthNumber)&&/мг|mg/iu.test(draft.strength);
    if(expected.kind==='medication')fields.medicine=/парацетамол|paracetamol/iu.test(draft.name);
    const result={caseId:c.id,sourceText:c.text||cases.find(x=>x.id===c.base).text,condition:c.base?`synthetic noise ${c.snr} dB, gain ${c.gain}`:'clean TTS',asr:name,asrName:pin.models[name].name,asrModelSha256:models[name].sha,audioSha256:audio.sha,transcript:text,asrMs,semanticMs,totalMs:asrMs+semanticMs,secondsAgo,draft,fields,passed:Object.values(fields).every(Boolean)};
    report.results.push(result);await checkpoint();console.log(JSON.stringify({caseId:c.id,asr:name,transcript:text,passed:result.passed,failed:Object.keys(fields).filter(k=>!fields[k]),asrMs,semanticMs}));
  }
}
report.summary=modelNames.map(name=>{const rows=report.results.filter(r=>r.asr===name);return {asr:name,asrName:pin.models[name].name,passed:rows.filter(r=>r.passed).length,total:rows.length,clarifications:rows.filter(r=>!r.draft.canAutoRecord).length,wrongAutomaticRecords:rows.filter(r=>r.draft.canAutoRecord&&!r.passed).length,meanAsrMs:Math.round(rows.reduce((n,r)=>n+r.asrMs,0)/rows.length),meanTotalMs:Math.round(rows.reduce((n,r)=>n+r.totalMs,0)/rows.length)};});
report.status=process.argv.includes('--canary')?'CANARY_COMPLETE':'COMPLETE';await checkpoint();const durable=JSON.parse(await readFile(reportPath,'utf8'));assert.equal(durable.results.length,report.results.length);console.log(JSON.stringify({status:report.status,summary:report.summary}));
