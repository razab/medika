import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assert,string} from './domain.mjs';
import {medicinePhotoKey} from '../public/medicine-images.js';
import {convertMedia,imageSize,isLinux} from './linux-media.mjs';
const exec=promisify(execFile);
function jpegSize(bytes){
  if(bytes[0]!==255||bytes[1]!==216)return null;let i=2;
  while(i+4<=bytes.length){if(bytes[i++]!==255)return null;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===217||marker===218)return null;const size=bytes.readUInt16BE(i);if(size<2||i+size>bytes.length)return null;if([192,193,194].includes(marker)){if(size<8)return null;return {width:bytes.readUInt16BE(i+5),height:bytes.readUInt16BE(i+3)};}i+=size;}
  return null;
}
export function medicinePhotoInput(input){
  const name=string(input.name,'Название лекарства',200,true),key=medicinePhotoKey(name);assert(key,'Укажите название лекарства');assert(input.key===undefined||input.key===key,'Неверная связь фото с лекарством');
  assert(Array.isArray(input.photos)&&input.photos.length>=1&&input.photos.length<=2,'Выберите одно или два фото');
  const photos=input.photos.map(data=>{assert(typeof data==='string'&&data.length<=44000&&/^[A-Za-z0-9+/]+=*$/.test(data),'Повреждено фото лекарства');const bytes=Buffer.from(data,'base64'),size=jpegSize(bytes);assert(bytes.length<=32768&&size&&size.width>0&&size.height>0&&size.width<=320&&size.height<=320,'Фото должно быть JPEG до 320 пикселей и 32 КБ');return data;});
  return {name,key,photos};
}
export async function prepareMedicinePhotos(images,dataDir,imageType){
  assert(Array.isArray(images)&&images.length>=1&&images.length<=2,'Выберите одно или два фото');const photos=[];
  for(const data of images){
    assert(typeof data==='string'&&data.length<=8*1024*1024&&/^[A-Za-z0-9+/]+=*$/.test(data),'Фото должно быть не больше 6 МБ',413);const bytes=Buffer.from(data,'base64');assert(bytes.length<=6*1024*1024,'Фото должно быть не больше 6 МБ',413);assert(imageType(bytes),'Поддерживаются JPEG, PNG и WebP',415);
    const dir=await mkdtemp(join(dataDir,'photo-'));
    try{
      const source=join(dir,'input'),target=join(dir,'photo.jpg');await writeFile(source,bytes,{mode:0o600});
      if(isLinux)await imageSize(source,24000000);
      else{
        const info=(await exec('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight',source],{timeout:10000,maxBuffer:4096})).stdout;
        const width=Number(info.match(/pixelWidth:\s*(\d+)/)?.[1]),height=Number(info.match(/pixelHeight:\s*(\d+)/)?.[1]);assert(width>0&&height>0&&width*height<=24000000,'Размер фото слишком большой');
      }
      let result;
      for(const [side,quality,qscale]of [[320,65,'8'],[240,40,'15']]){
        if(isLinux)await convertMedia(source,target,['-map_metadata','-1','-frames:v','1','-vf',`scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease`,'-q:v',qscale,'-update','1']);
        else await exec('/usr/bin/sips',['-Z',String(side),'-s','format','jpeg','-s','formatOptions',String(quality),source,'--out',target],{timeout:15000,maxBuffer:4096});
        result=await readFile(target);if(result.length<=32768)break;
      }
      assert(result.length<=32768,'Не удалось уменьшить фото');photos.push(result.toString('base64'));
    }finally{await rm(dir,{recursive:true,force:true});}
  }
  return photos;
}
