import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assert,InputError,string} from './domain.mjs';
const exec=promisify(execFile);
export function createLocalOCR(binary,dataDir){
 let busy=false;
 return async bytes=>{
  assert(!busy,'OCR уже выполняется. Дождитесь результата.',429);busy=true;let dir;
  try{dir=await mkdtemp(join(dataDir,'ocr-'));const path=join(dir,'image');await writeFile(path,bytes,{mode:0o600});const {stdout}=await exec(binary,[path],{timeout:45000,maxBuffer:2*1024*1024});const result=JSON.parse(stdout);return {...result,text:string(result.text,'Распознанный текст',50000,true)};}
  catch(e){if(e instanceof InputError)throw e;throw new InputError('Не удалось распознать изображение. Можно исправить или вставить текст.',422);}
  finally{if(dir)await rm(dir,{recursive:true,force:true});busy=false;}
 };
}
