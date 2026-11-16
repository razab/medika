import {access,mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assert,InputError,string} from './domain.mjs';
import {convertMedia,isLinux,probeMedia} from './linux-media.mjs';
const exec=promisify(execFile),site=join(dirname(fileURLToPath(import.meta.url)),'..');
const binary=process.env.MEDIKA_WHISPER_BIN||join(site,'tools/whisper.cpp/build/bin/whisper-cli');
const models={small:process.env.MEDIKA_WHISPER_SMALL||join(site,'data/models/ggml-small.bin'),medium:process.env.MEDIKA_WHISPER_MEDIUM||join(site,'data/models/ggml-medium.bin')};
const processor=isLinux?'на сервере':'на Mac';
let busy=false;
export async function voiceStatus(modelId='dual'){
  if(modelId==='dual'){const [small,medium]=await Promise.all([voiceStatus('small'),voiceStatus('medium')]);return {...small,ready:small.ready&&medium.ready,model:'dual',models:['small','medium'],engine:'Whisper Small + Whisper Medium · '+processor};}
  assert(Object.hasOwn(models,modelId),'Неизвестная модель речи');
  let ready=true;try{await Promise.all([access(binary),access(models[modelId])]);}catch{ready=false;}
  return {ready,engine:'Whisper '+(modelId==='small'?'Small':'Medium')+' · '+processor,model:modelId,languages:['ru','en'],maxSeconds:45,secureOrigin:'https://'+(process.env.MEDIKA_PUBLIC_HOST||'macbook-air-5.local')};
}
export async function prepareAudio(input,dataDir){
  assert(['ru','en'].includes(input.language),'Выберите русский или английский язык');
  assert(typeof input.audio==='string'&&/^[A-Za-z0-9+/]+=*$/.test(input.audio),'Некорректная аудиозапись');
  const bytes=Buffer.from(input.audio,'base64');assert(bytes.length>44&&bytes.length<=8*1024*1024,'Запись должна быть не больше 8 МБ',413);
  const wav=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE',aiff=bytes.toString('ascii',0,4)==='FORM',mp4=bytes.toString('ascii',4,8)==='ftyp';
  assert(wav||aiff||mp4,'Поддерживаются WAV, M4A и AIFF',415);
  let directory;
  try{
    directory=await mkdtemp(join(dataDir,'voice-'));
    const source=join(directory,wav?'input.wav':mp4?'input.m4a':'input.aiff'),converted=join(directory,'speech.wav');
    await writeFile(source,bytes,{mode:0o600});
    let duration;
    if(isLinux)duration=Number((await probeMedia(source,'format=duration')).format?.duration);
    else{
      const info=await exec('/usr/bin/afinfo',['-r',source],{timeout:10000,maxBuffer:65536});
      duration=Number(info.stdout.match(/estimated duration:\s*([\d.]+)\s*sec/iu)?.[1]);
    }
    assert(duration>0&&duration<=45,'Запись должна длиться не больше 45 секунд',413);
    if(isLinux)await convertMedia(source,converted,['-map','0:a:0','-map_metadata','-1','-t','46','-ac','1','-ar','16000','-c:a','pcm_s16le']);
    else await exec('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',source,converted],{timeout:15000,maxBuffer:65536});
    assert((await stat(converted)).size<=1505536,'Аудиозапись превышает допустимую длительность',413);
    const pcm=await readFile(converted);let peak=0,offset=12,dataOffset=0,dataLength=0;
    while(offset+8<=pcm.length){const size=pcm.readUInt32LE(offset+4);if(pcm.toString('ascii',offset,offset+4)==='data'){dataOffset=offset+8;dataLength=size;break;}offset+=8+size+(size%2);}
    assert(dataOffset&&dataOffset+dataLength<=pcm.length,'Повреждена аудиозапись',422);
    for(let i=dataOffset;i+1<dataOffset+dataLength;i+=2)peak=Math.max(peak,Math.abs(pcm.readInt16LE(i)));
    assert(peak>100,'В записи не слышно речи',422);
    return {bytes:pcm,duration,language:input.language};
  }catch(error){if(error instanceof InputError)throw error;throw new InputError('Не удалось прочитать аудиозапись',422);}
  finally{if(directory)await rm(directory,{recursive:true,force:true});}
}
async function recognizePrepared(bytes,language,dataDir,modelId){
  assert(Object.hasOwn(models,modelId),'Неизвестная модель речи');
  assert(['ru','en'].includes(language),'Выберите русский или английский язык');
  assert(Buffer.isBuffer(bytes)&&bytes.length>44&&bytes.length<=1505536&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE','Некорректный подготовленный WAV');
  let directory;
  try{
    assert((await voiceStatus(modelId)).ready,'Локальный движок речи ещё не установлен',503);
    directory=await mkdtemp(join(dataDir,'voice-'));const converted=join(directory,'speech.wav'),result=join(directory,'result');await writeFile(converted,bytes,{mode:0o600});
    await exec(binary,['-m',models[modelId],'-f',converted,'-l',language,'-t',isLinux?'2':'4','-oj','-of',result,'-np'],{timeout:90000,maxBuffer:2*1024*1024});
    const output=JSON.parse(await readFile(result+'.json','utf8')),text=string((output.transcription||[]).map(s=>s.text).join(' ').trim(),'Распознанная фраза',4000,true);
    assert(!/^\[.*\]$/u.test(text),'Речь не разобрана. Попробуйте ещё раз или введите текст.',422);
    return {text,language,model:modelId,engine:'whisper.cpp',local:true};
  }catch(error){if(error instanceof InputError)throw error;throw new InputError('Не удалось распознать запись. Можно ввести фразу текстом.',422);}
  finally{if(directory)await rm(directory,{recursive:true,force:true});}
}
async function recognitionLock(run){assert(!busy,'Распознавание уже идёт. Дождитесь результата.',429);busy=true;try{return await run();}finally{busy=false;}}
export async function transcribePrepared(bytes,language,dataDir,modelId='small'){return recognitionLock(()=>recognizePrepared(bytes,language,dataDir,modelId));}
export function combineTranscripts(transcripts){
  assert(Array.isArray(transcripts)&&transcripts.length===2&&transcripts[0].model==='small'&&transcripts[1].model==='medium','Нужны расшифровки Whisper Small и Whisper Medium');
  return string(transcripts.map(t=>'Whisper '+(t.model==='small'?'Small':'Medium')+':\n'+string(t.text,'Расшифровка',4000,true)).join('\n\n'),'Обе расшифровки',4000,true);
}
export async function transcribeAudio(input,dataDir){
  return recognitionLock(async()=>{const audio=await prepareAudio(input,dataDir),transcripts=[];
    for(const model of ['small','medium']){const start=performance.now(),result=await recognizePrepared(audio.bytes,audio.language,dataDir,model);transcripts.push({model,text:result.text,asrMs:Math.round(performance.now()-start)});}
    return {text:combineTranscripts(transcripts),transcripts,language:audio.language,duration:audio.duration,model:'dual',engine:'whisper.cpp',local:true};
  });
}
