import {access,mkdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),site=join(dirname(fileURLToPath(import.meta.url)),'..');
const pin=JSON.parse(await readFile(join(site,'voice-engine.json'),'utf8'));
const source=join(site,'tools/whisper.cpp'),model=join(site,'data/models/ggml-base.bin');
const exists=async path=>access(path).then(()=>true,()=>false);
const run=async(command,args)=>exec(command,args,{timeout:600000,maxBuffer:8*1024*1024});
const modelOK=async()=>{
  if(!await exists(model)||(await stat(model)).size!==pin.modelBytes)return false;
  return createHash('sha256').update(await readFile(model)).digest('hex')===pin.modelSha256;
};
await mkdir(join(site,'tools'),{recursive:true});await mkdir(dirname(model),{recursive:true,mode:0o700});
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
if(!await modelOK()){
  const partial=model+'.partial';
  try{
    const response=await fetch(pin.modelUrl,{signal:AbortSignal.timeout(180000)});
    if(!response.ok)throw Error('Model download HTTP '+response.status+'; stopped without retry');
    if(Number(response.headers.get('content-length'))!==pin.modelBytes)throw Error('Unexpected model size');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length!==pin.modelBytes||createHash('sha256').update(bytes).digest('hex')!==pin.modelSha256)throw Error('Model checksum mismatch');
    await writeFile(partial,bytes,{mode:0o600});await rename(partial,model);
  }finally{await rm(partial,{force:true});}
}
await run(join(source,'build/bin/whisper-cli'),['--help']);console.log('Local Whisper ready; pinned revision and model SHA256 verified.');
