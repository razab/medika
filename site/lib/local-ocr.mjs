import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assert,InputError,string} from './domain.mjs';
import {convertMedia,imageSize,isLinux} from './linux-media.mjs';
const exec=promisify(execFile);

async function linuxOCR(binary,path,dir){
  await imageSize(path,40000000);
  const normalized=join(dir,'image.png');
  await convertMedia(path,normalized,['-frames:v','1','-map_metadata','-1','-update','1']);
  const {stdout}=await exec(binary,[normalized,'stdout','-l','rus+eng+ron','--psm','6','tsv'],{
    timeout:45000,maxBuffer:2*1024*1024,env:{...process.env,OMP_THREAD_LIMIT:'1'}
  });
  const lines=new Map();
  let width=0,height=0;
  for(const row of stdout.split('\n').slice(1)){
    const fields=row.split('\t');
    const level=Number(fields[0]);
    const [left,top,w,h,confidence]=fields.slice(6,11).map(Number);
    if(level===1){width=w;height=h;continue;}
    const word=fields[11]?.trim();
    if(level!==5||!word||confidence<0)continue;
    const key=fields.slice(1,5).join(':');
    const line=lines.get(key)||{words:[],confidence:0,left,top,right:left+w,bottom:top+h};
    line.words.push(word);
    line.confidence+=confidence;
    line.left=Math.min(line.left,left);line.top=Math.min(line.top,top);
    line.right=Math.max(line.right,left+w);line.bottom=Math.max(line.bottom,top+h);
    lines.set(key,line);
  }
  assert(width>0&&height>0,'Не удалось определить размер изображения',422);
  const result=[...lines.values()].map(line=>({
    text:line.words.join(' '),confidence:Math.min(1,line.confidence/(100*line.words.length)),
    box:[line.left/width,1-line.bottom/height,(line.right-line.left)/width,(line.bottom-line.top)/height]
  }));
  return {text:result.map(line=>line.text).join('\n'),lines:result,languages:['ru-RU','en-US','ro-RO'],engine:'Tesseract',width,height};
}

export function createLocalOCR(binary,dataDir){
 let busy=false;
 return async bytes=>{
  assert(!busy,'OCR уже выполняется. Дождитесь результата.',429);busy=true;let dir;
  try{
    dir=await mkdtemp(join(dataDir,'ocr-'));
    const path=join(dir,'image');
    await writeFile(path,bytes,{mode:0o600});
    const result=isLinux?await linuxOCR(binary,path,dir):JSON.parse((await exec(binary,[path],{timeout:45000,maxBuffer:2*1024*1024})).stdout);
    return {...result,text:string(result.text,'Распознанный текст',50000,true)};
  }
  catch(e){if(e instanceof InputError)throw e;throw new InputError('Не удалось распознать изображение. Можно исправить или вставить текст.',422);}
  finally{if(dir)await rm(dir,{recursive:true,force:true});busy=false;}
 };
}
