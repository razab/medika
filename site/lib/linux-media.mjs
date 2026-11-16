import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assert} from './domain.mjs';

const exec=promisify(execFile), protocols='file,pipe';
export const isLinux=process.platform==='linux';

export async function probeMedia(source,entries,stream){
  const {stdout}=await exec('/usr/bin/ffprobe',[
    '-v','error','-max_alloc','100000000','-protocol_whitelist',protocols,
    ...(stream?['-select_streams',stream]:[]),'-show_entries',entries,'-of','json',source
  ],{timeout:10000,maxBuffer:16384});
  return JSON.parse(stdout);
}

export async function imageSize(source,limit){
  const {streams}=await probeMedia(source,'stream=width,height','v:0');
  const {width,height}=streams?.[0]||{};
  assert(width>0&&height>0&&width<=12000&&height<=12000&&width*height<=limit,'Размер фото слишком большой или формат повреждён');
  return {width,height};
}

export function convertMedia(source,target,options){
  return exec('/usr/bin/ffmpeg',[
    '-nostdin','-loglevel','error','-y','-max_alloc','100000000','-protocol_whitelist',protocols,
    '-threads','1','-i',source,'-threads','1','-filter_threads','1',...options,target
  ],{timeout:15000,maxBuffer:65536});
}
