import {access,mkdir,readFile,rename,rm,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createReadStream,createWriteStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const exec=promisify(execFile),site=join(dirname(fileURLToPath(import.meta.url)),'..');
const pin=JSON.parse(await readFile(join(site,'voice-engine.json'),'utf8'));
const source=join(site,'tools/whisper.cpp'),requested=process.argv[2]||pin.defaultModel;
if(requested!=='all'&&!Object.hasOwn(pin.models,requested))throw Error('Supported: Whisper Small (small), Whisper Medium (medium), all. Whisper Base is forbidden.');
const exists=async path=>access(path).then(()=>true,()=>false);
const run=async(command,args)=>exec(command,args,{timeout:600000,maxBuffer:8*1024*1024});
const modelOK=async(model,spec)=>{
  if(!await exists(model)||(await stat(model)).size!==spec.bytes)return false;
  const hash=createHash('sha256');for await(const chunk of createReadStream(model))hash.update(chunk);return hash.digest('hex')===spec.sha256;
};
await mkdir(join(site,'tools'),{recursive:true});await mkdir(join(site,'data/models'),{recursive:true,mode:0o700});
if(!await exists(source))await run('git',['clone',pin.repository,source]);
const head=(await run('git',['-C',source,'rev-parse','HEAD'])).stdout.trim();
if(head!==pin.commit){
  if((await run('git',['-C',source,'status','--porcelain'])).stdout.trim())throw Error('Whisper tree has local changes; left untouched');
  await run('git',['-C',source,'checkout','--detach',pin.commit]);
}
if(!await exists(join(source,'build/bin/whisper-cli'))){
  await run('cmake',['-S',source,'-B',join(source,'build'),'-DCMAKE_BUILD_TYPE=Release','-DWHISPER_BUILD_TESTS=OFF','-DWHISPER_BUILD_EXAMPLES=ON','-DGGML_METAL=ON','-DGGML_METAL_EMBED_LIBRARY=ON','-DWHISPER_CURL=OFF']);
  await run('cmake',['--build',join(source,'build'),'--target','whisper-cli','--config','Release','-j','4']);
}
for(const name of requested==='all'?Object.keys(pin.models):[requested]){
 const spec=pin.models[name],model=join(site,'data/models',spec.file);
 if(!await modelOK(model,spec)){
  const partial=model+'.partial';
  try{
    const probe=await fetch(spec.url,{headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(20000)});
    if(probe.status!==206)throw Error('Prefix probe HTTP '+probe.status+'; stopped without retry');
    const prefix=Buffer.from(await probe.arrayBuffer());if(prefix.length!==1024||prefix.toString('ascii',0,4)!=='lmgg')throw Error('Invalid model prefix');
    console.log(spec.name+': prefix canary passed');
    const response=await fetch(spec.url,{signal:AbortSignal.timeout(300000)});
    if(!response.ok)throw Error('Model download HTTP '+response.status+'; stopped without retry');
    if(Number(response.headers.get('content-length'))!==spec.bytes)throw Error('Unexpected model size');
    let bytes=0,last=0;const hash=createHash('sha256');
    await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>spec.bytes)return done(Error('Model exceeds expected size'));hash.update(chunk);if(bytes-last>=256*1024*1024){last=bytes;console.log(spec.name+': '+Math.round(bytes/1024/1024)+' MiB');}done(null,chunk);}}),createWriteStream(partial,{mode:0o600}));
    if(bytes!==spec.bytes||hash.digest('hex')!==spec.sha256)throw Error('Model checksum mismatch');
    await rename(partial,model);
  }finally{await rm(partial,{force:true});}
 }
 console.log(spec.name+': size and SHA256 verified');
}
await run(join(source,'build/bin/whisper-cli'),['--help']);console.log('Local Whisper ready; pinned revision and model SHA256 verified.');
