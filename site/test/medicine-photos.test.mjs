import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {medicinePhotoInput} from '../lib/medicine-photos.mjs';
import {medicineImages,medicinePhotoKey,photosForMedicine} from '../public/medicine-images.js';
test('Фото лекарств: сжатие, два снимка, приватность, версия, резервная копия и восстановление',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'medika-photos-')),restored=await mkdtemp(join(tmpdir(),'medika-photos-restore-')),port=14396,origin='http://127.0.0.1:'+port;let app,token;
 async function start(data){app=await createApp({dataDir:data,port});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));token=(await(await fetch(origin+'/api/session')).json()).token;}
 async function call(path,body,status=200,headers={}){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;}
 try{
  await start(dir);const before=await call('/backup'),image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
  await call('/medicine-photos',{name:'ТестПрепарат',images:[]},400);await call('/medicine-photos',{name:'ТестПрепарат',images:['!']},413);await call('/medicine-photos',{name:'ТестПрепарат',images:[image,image,image]},400);await call('/medicine-photos',{name:'ТестПрепарат',images:[image]},403,{Origin:'https://foreign.example'});
  const photo=await call('/medicine-photos',{name:'ТестПрепарат',images:[image,image],version:0});assert.equal(photo.photos.length,2);assert.deepEqual(photosForMedicine('ТестПрепарат',[photo]).photos.map(p=>p.kind),['package','product']);assert.ok(photo.photos.every(p=>Buffer.from(p,'base64').length<=32768));assert.equal(medicinePhotoInput(photo).key,photo.key);assert.equal(photosForMedicine('тестпрепарат',[photo]).custom,true);
  assert.equal((await fetch(origin+'/api/state')).status,403);await call('/medicine-photos',{name:'ТестПрепарат',images:[image],version:0},409);
  const update=await call('/medicine-photos',{name:'ТестПрепарат',images:[image],version:photo.version});assert.equal(update.photos.length,1);assert.equal(photosForMedicine('ТестПрепарат',[update]).photos[0].kind,'product');assert.equal(update.version,2);
  const backup=await call('/backup');assert.equal(backup.medicinePhotos.length,1);for(const k of ['people','documents','prescriptions','events','activities','temperatures'])assert.deepEqual(backup[k],before[k]);
  assert.throws(()=>medicinePhotoInput({...photo,key:'wrong'}));assert.throws(()=>medicinePhotoInput({...photo,photos:['AAAA']}));
  await app.close();await start(restored);assert.equal((await call('/restore',backup)).inserted,1);assert.deepEqual((await call('/state')).medicinePhotos,backup.medicinePhotos);assert.equal((await call('/restore',backup)).inserted,0);const bad={...backup,medicinePhotos:[{...backup.medicinePhotos[0],photos:['AAAA']}]};await call('/restore',bad,400);assert.deepEqual((await call('/state')).medicinePhotos,backup.medicinePhotos);
  assert.equal(medicinePhotoKey('Ринофлуимуцил'),medicinePhotoKey('Rinofluimucil'));assert.notEqual(medicinePhotoKey('Неизвестное'),medicinePhotoKey('Rinofluimucil'));assert.equal(photosForMedicine('Неизвестное').photos.length,0);
  for(const item of medicineImages){assert.equal(item.photos.length,2);assert.deepEqual(item.photos.map(p=>p.kind),['package','product']);for(const image of item.photos){if(image.crop){const [x,y,w,h,width,height]=image.crop;assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height);}
   const bytes=await readFile(new URL('../public'+image.src,import.meta.url));assert.ok(bytes.length<=32768);medicinePhotoInput({name:item.aliases[0],photos:[bytes.toString('base64')]});assert.equal((await fetch(origin+image.src)).status,200);}}
  assert.equal(photosForMedicine('Парацетамол свечи').photos.length,0);
  assert.equal((await fetch(origin+'/medicine-images/missing.jpg')).status,404);
 }finally{await app?.close();await rm(dir,{recursive:true,force:true});await rm(restored,{recursive:true,force:true});}
});
