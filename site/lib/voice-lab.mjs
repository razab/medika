import {mkdir,readdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {assert,string,newId,occurrenceInput,InputError} from './domain.mjs';
import {prepareAudio,transcribePrepared,voiceStatus} from './voice.mjs';
import {parseWithCodex,codexStatus} from './codex-parser.mjs';

export const labPhrases=[
  {id:'temperature',text:'Даня, две минуты назад температура тридцать восемь и два.',expected:{personId:'lab-danya',kind:'temperature',celsius:'38.2',secondsAgo:120}},
  {id:'tablet',text:'Даня получил половину таблетки парацетамола двести пятьдесят миллиграмм пять минут назад.',expected:{personId:'lab-danya',kind:'medication',amount:'0.5',unit:'табл.',strengthNumber:'250',secondsAgo:300}},
  {id:'suppository',text:'Дане поставили одну свечку парацетамола сто двадцать пять миллиграмм десять минут назад.',expected:{personId:'lab-danya',kind:'medication',amount:'1',unit:'свеча',strengthNumber:'125',secondsAgo:600}},
  {id:'retching',text:'Даня, позывы к рвоте три минуты назад.',expected:{personId:'lab-danya',kind:'retching',secondsAgo:180}},
  {id:'alice',text:'Алиса, температура тридцать семь и шесть сейчас.',expected:{personId:'lab-alice',kind:'temperature',celsius:'37.6',secondsAgo:0}},
  {id:'negative',text:'Даня не получил парацетамол.',expected:{noEvent:true}}
];
export const labVariants=[
  {id:'base-terra',label:'Whisper Base → Terra',asr:'base',model:'gpt-6.1-terra'},
  {id:'small-terra',label:'Whisper Small → Terra',asr:'small',model:'gpt-6.1-terra'},
  {id:'base-sol',label:'Whisper Base → Sol',asr:'base',model:'gpt-6.1-sol'},
  {id:'small-sol',label:'Whisper Small → Sol',asr:'small',model:'gpt-6.1-sol'},
  {id:'small-luna',label:'Whisper Small → Luna',asr:'small',model:'gpt-6-luna'}
];
const labState={people:[{id:'lab-danya',name:'Даня'},{id:'lab-alice',name:'Алиса'},{id:'lab-mom',name:'Мама'},{id:'lab-dad',name:'Папа'}],prescriptions:[],documents:[],activities:[]};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const idOK=id=>typeof id==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/.test(id);
export function scoreLabDraft(phraseId,draft,capturedAt){
  const expected=labPhrases.find(p=>p.id===phraseId)?.expected;if(!expected)return null;
  if(expected.noEvent)return {passed:!draft.canAutoRecord,checks:{noEvent:!draft.canAutoRecord}};
  const checks={automatic:draft.canAutoRecord};
  for(const key of ['personId','kind','celsius','amount','unit'])if(expected[key]!==undefined)checks[key]=String(draft[key])===expected[key];
  checks.time=!!draft.occurredAt&&(Date.parse(capturedAt)-Date.parse(draft.occurredAt))/1000===expected.secondsAgo;
  if(expected.kind==='medication')checks.medicine=/парацетамол|paracetamol/iu.test(draft.name)&&draft.strength.includes(expected.strengthNumber)&&/мг|mg/iu.test(draft.strength);
  return {passed:Object.values(checks).every(Boolean),checks};
}
export async function createVoiceLab(dataDir,{prepare=prepareAudio,transcribe=transcribePrepared,parse=parseWithCodex,availability}={}){
  const dir=join(dataDir,'voice-lab');await mkdir(dir,{recursive:true,mode:0o700});let busy=null;
  const jsonPath=id=>join(dir,id+'.json'),wavPath=id=>join(dir,id+'.wav');
  async function load(id){assert(idOK(id),'Неизвестная запись',404);try{return JSON.parse(await readFile(jsonPath(id),'utf8'));}catch(e){if(e.code==='ENOENT')throw new InputError('Запись не найдена',404);throw e;}}
  async function save(record){const tmp=jsonPath(record.id)+'.tmp';await writeFile(tmp,JSON.stringify(record),{mode:0o600});await rename(tmp,jsonPath(record.id));}
  async function records(){const names=(await readdir(dir)).filter(n=>n.endsWith('.json')&&idOK(n.slice(0,-5)));return (await Promise.all(names.map(n=>load(n.slice(0,-5))))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  function view(record){return {...record,results:Object.fromEntries(Object.entries(record.results).map(([id,r])=>[id,r.status==='running'&&busy!==record.id+':'+id?{...r,status:'interrupted'}:r]))};}
  async function locked(label,fn){assert(!busy,'Проверка уже идёт. Дождитесь её окончания.',409);busy=label;try{return await fn();}finally{busy=null;}}
  return {
    async state(){
      const ready=availability?await availability():await Promise.all([voiceStatus('base'),voiceStatus('small'),codexStatus()]).then(([base,small,codex])=>({base:base.ready,small:small.ready,codex:codex.ready}));
      return {phrases:labPhrases.map(({expected,...p})=>p),variants:labVariants.map(v=>({...v,reasoning:'low',ready:!!ready[v.asr]&&!!ready.codex})),recordings:(await records()).map(view),busy:!!busy};
    },
    async add(input){return locked('saving',async()=>{
      const clientKey=string(input.clientKey,'Ключ записи',120,true);assert(/^[a-zA-Z0-9_-]{8,120}$/.test(clientKey),'Некорректный ключ записи');
      const phraseId=string(input.phraseId,'Фраза',40,true),phrase=labPhrases.find(p=>p.id===phraseId);assert(phrase||phraseId==='custom','Неизвестная фраза');
      assert(typeof input.audio==='string'&&input.audio.length<=12*1024*1024&&/^[A-Za-z0-9+/]+=*$/.test(input.audio),'Некорректная аудиозапись',413);
      const inputSha256=hash(Buffer.from(input.audio,'base64')),all=await records(),found=all.find(r=>r.clientKey===clientKey);
      if(found){assert(found.inputSha256===inputSha256&&found.phraseId===phraseId,'Ключ относится к другой записи',409);return view(found);}
      assert(all.length<1000,'Сохранено 1000 записей. Удалите ненужные перед новой записью.');
      const capturedAt=occurrenceInput({personId:'voice-lab',occurredAt:input.capturedAt,timeZone:input.timeZone}).occurredAt;
      const audio=await prepare(input,dataDir),record={id:newId(),clientKey,inputSha256,phraseId,prompt:phrase?.text||string(input.prompt,'Своя фраза',4000),language:audio.language,duration:audio.duration,capturedAt,timeZone:input.timeZone||'Europe/Chisinau',audioSha256:hash(audio.bytes),createdAt:new Date().toISOString(),results:{},transcripts:{}};
      await writeFile(wavPath(record.id),audio.bytes,{mode:0o600});try{await save(record);}catch(e){await unlink(wavPath(record.id));throw e;}return view(record);
    });},
    async audio(id){const record=await load(id),bytes=await readFile(wavPath(id));assert(hash(bytes)===record.audioSha256,'Аудиофайл повреждён',422);return bytes;},
    async run(id,variantId){
      const variant=labVariants.find(v=>v.id===variantId);assert(variant,'Неизвестный вариант');
      return locked(id+':'+variantId,async()=>{
        const record=await load(id),previous=record.results[variantId];if(previous?.status==='complete')return previous;
        record.results[variantId]={status:'running',variantId};await save(record);
        try{
          const bytes=await readFile(wavPath(id));assert(hash(bytes)===record.audioSha256,'Аудиофайл повреждён',422);
          const cached=!!record.transcripts[variant.asr];let transcript=record.transcripts[variant.asr];
          if(!transcript){const start=performance.now(),result=await transcribe(bytes,record.language,dataDir,variant.asr);transcript={text:result.text,asrMs:Math.round(performance.now()-start),audioSha256:record.audioSha256};record.transcripts[variant.asr]=transcript;await save(record);}
          const start=performance.now(),draft=await parse(labState,{text:transcript.text,recordedAt:record.capturedAt,timeZone:record.timeZone},{model:variant.model}),parseMs=Math.round(performance.now()-start);
          const result={status:'complete',variantId,asr:variant.asr,model:variant.model,reasoning:'low',audioSha256:record.audioSha256,transcript:transcript.text,asrMs:transcript.asrMs,parseMs,totalMs:transcript.asrMs+parseMs,asrCached:cached,draft,score:scoreLabDraft(record.phraseId,draft,record.capturedAt),finishedAt:new Date().toISOString(),verdict:''};
          record.results[variantId]=result;await save(record);return result;
        }catch(e){const result={status:'failed',variantId,error:e instanceof InputError?e.message:'Не удалось выполнить проверку',errorStatus:e.status||500,finishedAt:new Date().toISOString()};record.results[variantId]=result;await save(record);return result;}
      });
    },
    async verdict(id,variantId,value){assert(['correct','wrong',''].includes(value),'Неизвестная оценка');return locked('verdict',async()=>{const record=await load(id);assert(record.results[variantId]?.status==='complete','Сначала выполните проверку');record.results[variantId].verdict=value;await save(record);return view(record);});},
    async remove(id){return locked('delete',async()=>{await load(id);await unlink(jsonPath(id));await unlink(wavPath(id));return {ok:true};});}
  };
}
