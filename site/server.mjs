import http from 'node:http';
import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openStore } from './lib/store.mjs';
import { assert, InputError, personInput, rxInput, temperatureInput, activityInput, day, newId, string, positive, scheduleFor, parseSuggestions, localParts,courseEnd } from './lib/domain.mjs';
import { catalog, rules, referenceInfo, checkPerson, intakeWarnings } from './lib/reference.mjs';
import { parseEntry } from './lib/entry-parser.mjs';
import { parseWithCodex,codexStatus,codexPeople } from './lib/codex-parser.mjs';
import { voiceStatus,transcribeAudio } from './lib/voice.mjs';
import { restoreBackup } from './lib/backup.mjs';
import { createVoiceLab } from './lib/voice-lab.mjs';
import {prepareMedicinePhotos,medicinePhotoInput} from './lib/medicine-photos.mjs';
import {medicinePhotoKey} from './public/medicine-images.js';

const exec=promisify(execFile), root=dirname(fileURLToPath(import.meta.url));
export function imageType(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return 'image/jpeg';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP') return 'image/webp';
  return null;
}
export async function createApp({dataDir=join(root,'data'),port=4382,publicHost='medika.localhost',additionalHosts=[],entryParser=parseEntry,voiceLabOptions={}}={}) {
  const store=openStore(dataDir), uploads=join(dataDir,'uploads');
  await mkdir(uploads,{recursive:true,mode:0o700});
  const voiceLab=await createVoiceLab(dataDir,{context:()=>codexPeople(store.state()),...voiceLabOptions});
  const token=randomBytes(32).toString('hex'), ocrBinary=join(root,'scripts/medika-ocr');
  let ocrReady=false,ocrBusy=false,photoBusy=false;
  try { await access(ocrBinary);ocrReady=true; } catch {}
  function recordActivity(raw){
    const input=activityInput({...raw,clientKey:raw.clientKey===undefined?newId():raw.clientKey});assert(store.get('people',input.personId),'Выберите человека');
    if(input.relatedRxId)assert(store.get('prescriptions',input.relatedRxId)?.personId===input.personId,'Назначение принадлежит другому человеку');
    const found=store.db.prepare('SELECT data FROM activities WHERE client_key=?').get(input.clientKey);
    if(found){const old=JSON.parse(found.data);assert(old.status!=='void'&&Object.entries(input).every(([k,v])=>old[k]===v),'Ключ относится к другой или отменённой записи. Проверьте журнал.',409);return {status:200,record:old};}
    return {status:201,record:store.insert('activities',{...input,status:'recorded'})};
  }
  const allowedHosts=new Set([publicHost,...additionalHosts,`medika.localhost:${port}`,`127.0.0.1:${port}`,`localhost:${port}`].flatMap(host=>host.includes(':')?[host.toLowerCase()]:[host.toLowerCase(),`${host.toLowerCase()}:80`,`${host.toLowerCase()}:443`]));
  async function body(req,limit=18*1024*1024) {
    assert(req.headers['content-type']?.startsWith('application/json'),'Ожидается JSON',415);
    const chunks=[];let length=0;
    for await(const chunk of req) { length+=chunk.length;assert(length<=limit,'Файл или запрос слишком большой',413);chunks.push(chunk); }
    try { const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert(value&&typeof value==='object'&&!Array.isArray(value),'Ожидается объект JSON');return value; } catch(e) { if(e instanceof InputError) throw e;throw new InputError('Некорректный JSON'); }
  }
  const server=http.createServer(async(req,res)=>{
    const send=(status,value,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      assert(allowedHosts.has(req.headers.host?.toLowerCase()),'Этот адрес не разрешён',403);
      const scheme=req.headers['x-forwarded-proto']==='https'&&['127.0.0.1','::1'].includes(req.socket.remoteAddress)?'https':'http';
      const url=new URL(req.url,`${scheme}://${req.headers.host}`), route=url.pathname, method=req.method;
      // Links from chats may be cross-site; the shell and public CA contain no medical data.
      const publicRead=['GET','HEAD'].includes(method)&&['/','/voice-lab','/voice-lab/','/medika-ca.cer'].includes(route);
      if(!publicRead){
        assert(!req.headers.origin||req.headers.origin===url.origin,'Запрос с другого сайта отклонён',403);
        assert(req.headers['sec-fetch-site']!=='cross-site','Запрос с другого сайта отклонён',403);
      }
      if(route==='/api/health'&&method==='GET') return send(200,{ok:true,app:'medika',version:'0.1.0',ocr:ocrReady});
      if(route==='/api/session'&&method==='GET') return send(200,{token},{'Set-Cookie':`medika_session=${token}; HttpOnly; SameSite=Strict; Path=/`});
      const imageRoute=route.match(/^\/api\/documents\/([a-f\d-]+)\/image$/);
      const labAudioRoute=route.match(/^\/api\/voice-lab\/recordings\/([a-f\d-]+)\/audio$/);
      if(route.startsWith('/api/')) {
        if(imageRoute&&method==='GET'||labAudioRoute&&['GET','HEAD'].includes(method)) assert(req.headers.cookie?.split(';').some(s=>s.trim()===`medika_session=${token}`),'Откройте приложение перед просмотром',403);
        else assert(req.headers['x-medika-token']===token,'Сессия обновлена. Перезагрузите страницу.',403);
      }
      if(labAudioRoute&&['GET','HEAD'].includes(method)){
        const bytes=await voiceLab.audio(labAudioRoute[1]),range=req.headers.range;let start=0,end=bytes.length-1;
        if(range){const match=range.match(/^bytes=(\d*)-(\d*)$/);if(!match||!match[1]&&!match[2]){res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`});return res.end();}
          if(!match[1])start=Math.max(0,bytes.length-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length){res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`});return res.end();}
        }
        res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,'Content-Disposition':`inline; filename=voice-${labAudioRoute[1]}.wav`,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});return res.end(method==='HEAD'?undefined:bytes.subarray(start,end+1));
      }
      if(route==='/api/voice-lab'&&method==='GET')return send(200,await voiceLab.state());
      if(route==='/api/voice-lab/recordings'&&method==='POST')return send(201,await voiceLab.add(await body(req,12*1024*1024)));
      const labRecordRoute=route.match(/^\/api\/voice-lab\/recordings\/([a-f\d-]+)$/),labRunRoute=route.match(/^\/api\/voice-lab\/recordings\/([a-f\d-]+)\/(run|verdict)$/);
      if(labRecordRoute&&method==='DELETE')return send(200,await voiceLab.remove(labRecordRoute[1]));
      if(labRunRoute&&method==='POST'){const input=await body(req);return send(200,labRunRoute[2]==='run'?await voiceLab.run(labRunRoute[1],input.variantId):await voiceLab.verdict(labRunRoute[1],input.variantId,input.verdict));}
      if(route==='/api/medicine-photos'&&method==='POST'){
        assert(!photoBusy,'Фото уже обрабатывается. Попробуйте ещё раз через несколько секунд.',429);photoBusy=true;
        try {
        const input=await body(req),name=string(input.name,'Название лекарства',200,true),key=medicinePhotoKey(name),old=store.state().medicinePhotos.find(p=>p.key===key);assert((input.version??0)===(old?.version??0),'Фото уже изменено. Обновите страницу.',409);
        const photos=await prepareMedicinePhotos(input.images,dataDir,imageType),record=medicinePhotoInput({name,photos});const current=store.state().medicinePhotos.find(p=>p.key===key);assert((current?.version??0)===(old?.version??0),'Фото уже изменено. Обновите страницу.',409);
        return send(200,current?store.update('medicinePhotos',current.id,record,current.version):store.insert('medicinePhotos',record));
        }finally{photoBusy=false;}
      }
      if(route==='/api/state'&&method==='GET') return send(200,{...store.state(),catalog,rules,reference:referenceInfo,capabilities:{ocr:ocrReady,ocrLanguages:['ru-RU','en-US'],notifications:'open-tab-only',voice:await voiceStatus(),entryParser:entryParser===parseWithCodex?await codexStatus():{model:'local-rules',cloud:false}}});
      if(route==='/api/parse-entry'&&method==='POST')return send(200,await entryParser(store.state(),await body(req)));
      if(route==='/api/record-entry'&&method==='POST'){
        const input=await body(req);
        if(input.clientKey){
          const found=store.db.prepare('SELECT data FROM activities WHERE client_key=?').get(string(input.clientKey,'Ключ записи',120));
          if(found){const record=JSON.parse(found.data);assert(record.status!=='void'&&record.sourceText===string(input.text,'Фраза',4000,true)&&record.timeZone===(input.timeZone||'Europe/Chisinau'),'Ключ относится к другой или отменённой записи.',409);return send(200,{record});}
        }
        const draft=await entryParser(store.state(),{...input,personId:''});
        if(!draft.canAutoRecord)return send(200,{draft,needsReview:true});
        assert(input.recordedAt&&input.clientKey,'Отсутствует время или ключ записи');
        const result=recordActivity({...draft,clientKey:input.clientKey});return send(result.status,{record:result.record});
      }
      if(route==='/api/transcribe'&&method==='POST'){
        const input=await body(req,12*1024*1024);return send(200,await transcribeAudio(input,dataDir));
      }
      if(['/api/activities','/api/entries'].includes(route)&&method==='POST'){
        const result=recordActivity(await body(req));return send(result.status,result.record);
      }
      const activityVoid=route.match(/^\/api\/activities\/([a-f\d-]+)\/void$/);
      if(activityVoid&&method==='POST'){
        const input=await body(req),record=store.get('activities',activityVoid[1]);assert(record,'Событие не найдено',404);assert(record.status!=='void','Событие уже отменено',409);
        return send(200,store.update('activities',record.id,{status:'void',voidReason:string(input.reason,'Причина отмены',1000,true)},input.version));
      }
      if(route==='/api/temperatures'&&method==='POST'){
        const input=temperatureInput(await body(req));assert(store.get('people',input.personId),'Выберите человека');
        return send(201,store.insert('temperatures',{...input,status:'recorded'}));
      }
      const temperatureVoid=route.match(/^\/api\/temperatures\/([a-f\d-]+)\/void$/);
      if(temperatureVoid&&method==='POST'){
        const input=await body(req),record=store.get('temperatures',temperatureVoid[1]);assert(record,'Измерение не найдено',404);assert(record.status!=='void','Измерение уже отменено',409);
        return send(200,store.update('temperatures',record.id,{status:'void',voidReason:string(input.reason,'Причина отмены',1000,true)},input.version));
      }
      if(route==='/api/course-end'&&method==='POST'){const input=await body(req);return send(200,{endDate:courseEnd(input.startDate,input.count,input.unit),convention:'Последний день включительно: день перед календарной годовщиной начала курса. Проверьте границу по назначению.'});}
      if(route==='/api/people'&&method==='POST') return send(201,store.insert('people',personInput(await body(req))));
      const personRoute=route.match(/^\/api\/people\/([a-f\d-]+)$/);
      if(personRoute&&method==='PUT') { const input=await body(req);return send(200,store.update('people',personRoute[1],personInput(input),input.version)); }
      if(route==='/api/prescriptions'&&method==='POST') {
        const input=await body(req),rx=rxInput(input);
        assert(store.get('people',input.personId),'Выберите человека');
        if(rx.documentId) assert(store.get('documents',rx.documentId)?.personId===input.personId,'Документ принадлежит другому человеку');
        return send(201,store.insert('prescriptions',{...rx,personId:input.personId,archived:false}));
      }
      const rxRoute=route.match(/^\/api\/prescriptions\/([a-f\d-]+)$/);
      if(rxRoute&&method==='PUT') {
        const input=await body(req),old=store.get('prescriptions',rxRoute[1]);assert(old,'Назначение не найдено',404);
        const rx=rxInput(input);
        if(rx.documentId) assert(store.get('documents',rx.documentId)?.personId===old.personId,'Документ принадлежит другому человеку');
        return send(200,store.update('prescriptions',old.id,{...rx,archived:input.archived===true},input.version));
      }
      const archiveRoute=route.match(/^\/api\/prescriptions\/([a-f\d-]+)\/archive$/);
      if(archiveRoute&&method==='POST') { const input=await body(req);return send(200,store.update('prescriptions',archiveRoute[1],{archived:input.archived!==false},input.version)); }
      if(route==='/api/schedule'&&method==='GET') {
        const date=day(url.searchParams.get('date')),personId=url.searchParams.get('personId'),state=store.state();
        const prescriptions=state.prescriptions.filter(r=>!personId||r.personId===personId);
        const planned=prescriptions.flatMap(r=>scheduleFor(r,date));
        const items=planned.map(e=>({...e,event:state.events.find(x=>x.key===e.key&&x.status!=='void')||null}));
        const recorded=state.events.filter(e=>e.date===date&&e.status!=='void'&&(!personId||e.personId===personId)&&!planned.some(p=>p.key===e.key)).map(event=>({...event,event,historical:true}));
        const prn=prescriptions.filter(r=>r.type==='prn'&&!r.archived&&r.startDate<=date&&(!r.endDate||r.endDate>=date));
        return send(200,{items:[...items,...recorded].sort((a,b)=>(a.scheduledAt||a.occurredAt).localeCompare(b.scheduledAt||b.occurredAt)),prn});
      }
      if(route==='/api/check'&&method==='POST') {
        const input=await body(req),state=store.state();assert(state.people.some(p=>p.id===input.personId),'Выберите человека');
        const candidate=input.candidate?{name:string(input.candidate.name,'Препарат',200,true),ingredients:string(input.candidate.ingredients,'Состав',600).split(/[+;,\n]/).map(s=>s.trim()).filter(Boolean)}:null;
        const rx=input.rxId?store.get('prescriptions',input.rxId):null;assert(!rx||rx.personId===input.personId,'Назначение принадлежит другому человеку');
        const at=input.at||new Date().toISOString();assert(Number.isFinite(Date.parse(at)),'Некорректное время');
        return send(200,{...checkPerson(state,{personId:input.personId,candidate:rx||candidate,excludeId:rx?.id,at}),intakeWarnings:rx?intakeWarnings(state,rx,at):[]});
      }
      if(route==='/api/events'&&method==='POST') {
        const input=await body(req),rx=store.get('prescriptions',input.rxId);assert(rx,'Назначение не найдено',404);
        assert(['taken','skipped','deferred'].includes(input.status),'Неизвестный статус');
        const occurredAt=input.occurredAt||new Date().toISOString();assert(Number.isFinite(Date.parse(occurredAt)),'Некорректное фактическое время');
        assert(Date.parse(occurredAt)<=Date.now()+60000,'Фактический приём не может быть в будущем');
        const date=rx.type==='prn'?localParts(occurredAt,rx.timeZone).date:day(input.date),event=rx.type==='prn'?null:scheduleFor(rx,date).find(e=>e.key===input.key);
        assert(event||rx.type==='prn'&&!rx.archived&&date>=rx.startDate&&(!rx.endDate||date<=rx.endDate),'Событие отсутствует в действующем расписании');
        assert(rx.type!=='prn'||input.status==='taken','Для приёма по необходимости записывается факт');
        const key=event?.key||`${rx.id}@prn-${newId()}`;
        const old=store.db.prepare('SELECT data FROM events WHERE event_key=?').get(key);
        assert(!old||JSON.parse(old.data).status==='void','Этот приём уже отмечен. Обновите расписание.',409);
        const actualDose=input.status==='taken'?positive(input.dose||rx.dose,'Фактическая доза'):rx.dose;
        const record={...(event||{rxId:rx.id,personId:rx.personId,name:rx.name,dose:rx.dose,unit:rx.unit,timeZone:rx.timeZone,conditions:rx.conditions,ingredients:rx.ingredients,date,time:localParts(occurredAt,rx.timeZone).time,...(rx.doseScope?{doseScope:rx.doseScope}:{}),...(rx.purpose?{purpose:rx.purpose}:{}),...(rx.carePhase!==undefined?{carePhase:rx.carePhase}:{})}),key,status:input.status,occurredAt:new Date(occurredAt).toISOString(),actualDose,note:string(input.note,'Примечание',2000),author:string(input.author||'Я','Автор',100)};
        if(old) {const previous=JSON.parse(old.data);return send(200,store.update('events',previous.id,record,previous.version));}
        return send(201,store.insert('events',record));
      }
      const voidRoute=route.match(/^\/api\/events\/([a-f\d-]+)\/void$/);
      if(voidRoute&&method==='POST') { const input=await body(req);assert(string(input.reason,'Причина исправления',1000,true),'Укажите причину');return send(200,store.update('events',voidRoute[1],{status:'void',voidReason:input.reason},input.version)); }
      if(route==='/api/documents'&&method==='POST') {
        const input=await body(req);assert(store.get('people',input.personId),'Выберите человека');
        const sourceKind=input.sourceKind||'doctor';assert(['doctor','household','other'].includes(sourceKind),'Неизвестный источник');
        let bytes=null,mime='',text='',lines=[],name=string(input.name||'Текст выписки','Название',250);
        if(input.image) {
          assert(typeof input.image==='string'&&/^[A-Za-z0-9+/]+=*$/.test(input.image),'Некорректное изображение');
          bytes=Buffer.from(input.image,'base64');assert(bytes.length<=12*1024*1024,'Максимальный размер изображения — 12 МБ',413);
          mime=imageType(bytes);assert(mime,'Поддерживаются PNG, JPEG и WebP',415);assert(ocrReady,'Локальное распознавание ещё не настроено',503);
        } else text=string(input.text,'Текст выписки',50000,true);
        const hash=createHash('sha256').update(bytes||text).digest('hex');
        const found=store.db.prepare('SELECT data FROM documents WHERE person_id=? AND hash=?').get(input.personId,hash);
        if(found) return send(200,{...JSON.parse(found.data),duplicate:true});
        const id=newId();
        if(bytes) {
          assert(!ocrBusy,'Распознавание уже выполняется. Дождитесь результата перед следующей загрузкой.',429);
          ocrBusy=true;
          try {
            await writeFile(join(uploads,id),bytes,{mode:0o600});
            const {stdout}=await exec(ocrBinary,[join(uploads,id)],{timeout:45000,maxBuffer:2*1024*1024});
            const result=JSON.parse(stdout);text=string(result.text,'Распознанный текст',50000);lines=result.lines;
          } catch(e) { await unlink(join(uploads,id)).catch(()=>{});throw new InputError('Не удалось распознать изображение. Проверьте файл; можно вставить текст вручную.',422); }
          finally {ocrBusy=false;}
        }
        return send(201,store.insert('documents',{id,personId:input.personId,hash,name,mime,text,lines,ocrText:text,sourceKind,reviewNotes:'',suggestions:sourceKind==='household'?[]:parseSuggestions(text)}));
      }
      const docRoute=route.match(/^\/api\/documents\/([a-f\d-]+)$/);
      if(docRoute&&method==='PUT') {
        const input=await body(req),old=store.get('documents',docRoute[1]);assert(old,'Документ не найден',404);
        const text=string(input.text??old.text,'Текст выписки',50000),sourceKind=input.sourceKind||old.sourceKind||'doctor';
        assert(['doctor','household','other'].includes(sourceKind),'Неизвестный источник');
        return send(200,store.update('documents',docRoute[1],{text,ocrText:old.ocrText??old.text,sourceKind,reviewNotes:string(input.reviewNotes??old.reviewNotes,'Заметки сверки',12000),suggestions:sourceKind==='household'?[]:parseSuggestions(text)},input.version));
      }
      if(imageRoute&&method==='GET') {
        const doc=store.get('documents',imageRoute[1]);assert(doc?.mime,'Изображение не найдено',404);
        res.writeHead(200,{'Content-Type':doc.mime,'Content-Disposition':'inline'});return res.end(await readFile(join(uploads,doc.id)));
      }
      if(route==='/api/backup'&&method==='GET') {
        const state=store.state();
        const images={};for(const doc of state.documents) if(doc.mime) images[doc.id]=(await readFile(join(uploads,doc.id))).toString('base64');
        return send(200,{...state,format:'medika-backup',version:4,exportedAt:new Date().toISOString(),images,audit:store.history()},{'Content-Disposition':`attachment; filename="medika-backup-${new Date().toISOString().slice(0,10)}.json"`});
      }
      if(route==='/api/restore'&&method==='POST') return send(200,await restoreBackup(store,uploads,await body(req,64*1024*1024),imageType));
      if(route==='/api/audit'&&method==='GET') return send(200,store.history().slice(-200).reverse());
      assert(!route.startsWith('/api/'),'Метод или маршрут не найден',404);
      assert(method==='GET'||method==='HEAD','Метод не разрешён',405);
      if(route==='/medika-ca.cer'&&method==='GET'){res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename=medika-ca.cer'});return res.end(await readFile(join(root,'data/medika-ca.cer')));}
      const packageImage=route.match(/^\/medicine-images\/([a-z0-9-]+\.jpg)$/);if(packageImage){let bytes;try{bytes=await readFile(join(root,'public/medicine-images',packageImage[1]));}catch{throw new InputError('Фото не найдено',404);}res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=86400'});return res.end(method==='HEAD'?undefined:bytes);}
      const assets={'/':['index.html','text/html'],'/voice-lab':['voice-lab.html','text/html'],'/voice-lab/':['voice-lab.html','text/html'],'/voice-lab.js':['voice-lab.js','text/javascript'],'/voice-lab.css':['voice-lab.css','text/css'],'/prescription-summary.js':['prescription-summary.js','text/javascript'],'/medicine-images.js':['medicine-images.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/icon.svg':['icon.svg','image/svg+xml'],'/voice-recorder.js':['voice-recorder.js','text/javascript'],'/voice-capture.js':['voice-capture.js','text/javascript']};
      assert(assets[route],'Страница не найдена',404);
      const [file,mime]=assets[route];res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`});res.end(method==='HEAD'?undefined:await readFile(join(root,'public',file)));
    } catch(e) {
      if(res.headersSent) return res.destroy();
      if(!(e instanceof InputError)) console.error('Ошибка запроса:',e.code||e.name);
      send(e.status||500,{error:e instanceof InputError?e.message:'Не удалось сохранить или прочитать данные. Повторите после проверки сервера.'});
    }
  });
  server.requestTimeout=60000;server.headersTimeout=15000;
  return {server,store,close:()=>new Promise(resolve=>server.close(()=>{store.close();resolve();}))};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  const port=Number(process.env.PORT||4382),additionalHosts=(process.env.MEDIKA_LAN_HOSTS||'').split(',').map(host=>host.trim()).filter(Boolean),app=await createApp({port,additionalHosts,entryParser:parseWithCodex,dataDir:process.env.MEDIKA_DATA_DIR||join(root,'data')});
  app.server.listen(port,'127.0.0.1',()=>console.log('Медика: http://medika.localhost'+additionalHosts.map(host=>` · http://${host}`).join('')));
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await app.close();process.exit(0);});
}
