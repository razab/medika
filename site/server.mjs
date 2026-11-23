import {createMedicineRecognition} from './lib/medicine-recognition.mjs';
import {medicineInput,medicineKey,validateMedicineSequence} from './lib/medicines.mjs';
import {familyView} from './lib/family-view.mjs';
import {courseSupply} from './lib/course-supply.mjs';
import {createLocalOCR} from './lib/local-ocr.mjs';
import {createPrescriptionLab} from './lib/prescription-lab.mjs';
import {applyPrescriptionPlan} from './lib/prescription-import.mjs';
import {availableSlots} from './lib/prescription-plan.mjs';
import http from 'node:http';
import {isIP} from 'node:net';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { openStore } from './lib/store.mjs';
import { assert, InputError, occurrenceInput, validateRoutineBinding, personInput, rxInput, temperatureInput, activityInput, procedureNote, day, newId, string, positive, scheduleFor, parseSuggestions, localParts, nextDay, zonedInstant, courseEnd } from './lib/domain.mjs';
import { catalog, rules, referenceInfo, checkPerson, intakeWarnings } from './lib/reference.mjs';
import { parseEntry,parseLocalEntry } from './lib/entry-parser.mjs';
import { parseWithCodex,codexStatus,codexPeople } from './lib/codex-parser.mjs';
import { restoreBackup } from './lib/backup.mjs';
import { createVoiceLab } from './lib/voice-lab.mjs';
import {prepareMedicinePhotos,medicinePhotoInput} from './lib/medicine-photos.mjs';
import {medicinePhotoKey} from './public/medicine-images.js';
import {openAuth,sameToken,sessionCookie} from './lib/auth.mjs';
import {createGoogleAuth,googleCallback,googleCookie} from './lib/google-auth.mjs';
import {isLinux} from './lib/linux-media.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const familyDayStart='06:00';
const accountPages=new Map([['/login','login.html'],['/login/code','login-code.html'],['/register','register.html'],['/account','account.html']]);
const loginPages=new Set(['/login','/login/code']);
const accountAssets=new Map([['/account.js','text/javascript'],['/account.css','text/css'],['/icon.svg','image/svg+xml'],['/google-logo.png','image/png']]);
// Public design shells and synthetic specimens; copied medical data stays behind the API.
const designStudyAssets=Object.fromEntries([
  ['/family-appearance.js',['family-appearance.js','text/javascript']],
  ['/family-appearance.css',['family-appearance.css','text/css']],
  ['/design-study/round-10',['design-study/round-10/index.html','text/html']],
  ['/design-study/round-10/',['design-study/round-10/index.html','text/html']],
  ['/design-study/round-10/study.css',['design-study/round-10/study.css','text/css']],
  ['/design-study/round-10/study.js',['design-study/round-10/study.js','text/javascript']],
  ['/design-study/round-9',['design-study/round-9/index.html','text/html']],
  ['/design-study/round-9/',['design-study/round-9/index.html','text/html']],
  ['/design-study/round-9/gallery.css',['design-study/round-9/gallery.css','text/css']],
  ...['r1','r2','r3'].map(id=>['/design-study/round-9/'+id+'.png',['design-study/round-9/'+id+'.png','image/png']]),
  ['/design-study/round-8',['design-study/round-8/index.html','text/html']],
  ['/design-study/round-8/',['design-study/round-8/index.html','text/html']],
  ['/design-study/round-8/gallery.css',['design-study/round-8/gallery.css','text/css']],
  ...['s1','s2','s3','s4','s5'].map(id=>['/design-study/round-8/'+id+'.png',['design-study/round-8/'+id+'.png','image/png']]),
  ['/design-study/round-7',['design-study/round-7/index.html','text/html']],
  ['/design-study/round-7/',['design-study/round-7/index.html','text/html']],
  ['/design-study/round-7/gallery.css',['design-study/round-7/gallery.css','text/css']],
  ...['v1','v2','v3','v4','v5'].map(id=>['/design-study/round-7/'+id+'.png',['design-study/round-7/'+id+'.png','image/png']]),
  ['/design-study/round-6',['design-study/round-6/index.html','text/html']],
  ['/design-study/round-6/',['design-study/round-6/index.html','text/html']],
  ['/design-study/round-6/gallery.css',['design-study/round-6/gallery.css','text/css']],
  ...['c1','c2','c3'].map(id=>['/design-study/round-6/'+id+'.png',['design-study/round-6/'+id+'.png','image/png']]),
  ['/design-study/round-5',['design-study/round-5/index.html','text/html']],
  ['/design-study/round-5/',['design-study/round-5/index.html','text/html']],
  ['/design-study/round-5/gallery.css',['design-study/round-5/gallery.css','text/css']],
  ...['d1','d2','d3','l1','l2'].map(id=>['/design-study/round-5/'+id+'.png',['design-study/round-5/'+id+'.png','image/png']]),
  ['/design-study/round-4',['design-study/round-4/index.html','text/html']],
  ['/design-study/round-4/',['design-study/round-4/index.html','text/html']],
  ['/design-study/round-4/gallery.css',['design-study/round-4/gallery.css','text/css']],
  ...['vd1','vd2','vd3'].map(id=>['/design-study/round-4/'+id+'.png',['design-study/round-4/'+id+'.png','image/png']]),
  ['/design-study/round-3',['design-study/round-3/index.html','text/html']],
  ['/design-study/round-3/',['design-study/round-3/index.html','text/html']],
  ...['feed','family','large','sequence','panels'].map(id=>['/design-study/round-3/'+id,['design-study/round-3/preview.html','text/html']]),
  ...['study.js','variants.js','gallery.js','study.css','gallery.css'].map(file=>['/design-study/round-3/'+file,['design-study/round-3/'+file,file.endsWith('.js')?'text/javascript':'text/css']]),
  ...['feed','family','large','sequence','panels'].flatMap(id=>['phone','tablet','large'].map(size=>['/design-study/round-3/previews/'+id+'-'+size+'.png',['design-study/round-3/previews/'+id+'-'+size+'.png','image/png']])),
  ['/design-study/round-2',['design-study/round-2/index.html','text/html']],
  ['/design-study/round-2/',['design-study/round-2/index.html','text/html']],
  ...['calm','agenda','people','focus','board'].map(id=>['/design-study/round-2/'+id,['design-study/round-2/preview.html','text/html']]),
  ...['study.js','variants.js','gallery.js','study.css','gallery.css'].map(file=>['/design-study/round-2/'+file,['design-study/round-2/'+file,file.endsWith('.js')?'text/javascript':'text/css']]),
  ...['nunito','source-sans'].map(id=>['/design-study/round-2/fonts/'+id+'.ttf',['design-study/round-2/fonts/'+id+'.ttf','font/ttf']]),
  ...['calm','agenda','people','focus','board'].flatMap(id=>['phone','tablet'].map(size=>['/design-study/round-2/previews/'+id+'-'+size+'.png',['design-study/round-2/previews/'+id+'-'+size+'.png','image/png']])),
  ['/design-study',['design-study/index.html','text/html']],
  ['/design-study/',['design-study/index.html','text/html']],
  ['/design-study.css',['design-study.css','text/css']],
  ['/design-study/a1-synthetic',['design-study/a1-synthetic.html','text/html']],
  ['/design-study/a1-events.js',['design-study/a1-events.js','text/javascript']],
  ['/design-study/a1-sandbox.js',['design-study/a1-sandbox.js','text/javascript']],
  ['/design-study/a1-sandbox.css',['design-study/a1-sandbox.css','text/css']],
  ...['a1','a2','a3','b1','b2','b3','c1','c2','c3'].map(id=>['/design-study/'+id,['design-study/'+id+'.html','text/html']]),
  ...['golostext','manrope'].map(id=>['/design-study/'+id+'.ttf',['design-study/'+id+'.ttf','font/ttf']])
]);
export function imageType(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return 'image/jpeg';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP') return 'image/webp';
  return null;
}
export async function createApp({dataDir=join(root,'data'),port=4382,publicHost='medika.localhost',additionalHosts=[],requireAccount=false,entryParser=requireAccount?parseLocalEntry:parseEntry,voiceLabOptions={},medicineRecognitionOptions={},googleOptions={}}={}) {
  const store=openStore(dataDir), uploads=join(dataDir,'uploads');
  const auth=requireAccount?openAuth(store.db):null;
  const google=auth?createGoogleAuth(store.db,{...googleOptions,publicHost}):null;
  await mkdir(uploads,{recursive:true,mode:0o700});
  const voiceLab=await createVoiceLab(dataDir,{context:()=>({people:codexPeople(store.state()),medicines:store.state().medicines.filter(m=>!m.archived).map(m=>m.name)}),...voiceLabOptions,modelRuns:!requireAccount});
  const token=randomBytes(32).toString('hex'),ocrBinary=isLinux?'/usr/bin/tesseract':join(root,'scripts/medika-ocr');
  let ocrReady=false,photoBusy=false;
  try { await access(ocrBinary);ocrReady=true; } catch {}
  const recognize=createLocalOCR(ocrBinary,dataDir),prescriptionLab=await createPrescriptionLab(dataDir,{recognize:async bytes=>{const hash=createHash('sha256').update(bytes).digest('hex'),saved=store.db.prepare('SELECT data FROM documents WHERE hash=?').all(hash).map(r=>JSON.parse(r.data)).filter(d=>d.mime);if(saved.length){const d=saved[0],reviewed=saved.every(x=>x.sourceKind==='doctor'&&x.text===d.text);return {text:d.ocrText??d.text,lines:d.lines||[],engine:'Apple Vision · сохранённый результат',...(reviewed&&d.text!==(d.ocrText??d.text)?{reviewedText:d.text}:{})};}assert(ocrReady,'OCR не настроен',503);return recognize(bytes);},imageType});
  const medicineRecognition=await createMedicineRecognition(dataDir,{recognize,imageType,local:requireAccount,...medicineRecognitionOptions});
  function recordActivity(raw){
    const input=activityInput({...raw,clientKey:raw.clientKey===undefined?newId():raw.clientKey});assert(store.get('people',input.personId),'Выберите человека');
    if(input.relatedRxId)assert(store.get('prescriptions',input.relatedRxId)?.personId===input.personId,'Назначение принадлежит другому человеку');
    const found=store.db.prepare('SELECT data FROM activities WHERE client_key=?').get(input.clientKey);
    if(found){const old=JSON.parse(found.data);assert(old.status!=='void'&&Object.entries(input).every(([k,v])=>old[k]===v),'Ключ относится к другой или отменённой записи. Проверьте журнал.',409);return {status:200,record:old};}
    return {status:201,record:store.insert('activities',{...input,status:'recorded'})};
  }
  function scheduleView(state,date,personId='',familyDay=false){
        const prescriptions=state.prescriptions.filter(r=>!personId||r.personId===personId);
        const planned=prescriptions.flatMap(rx=>{
          const person=state.people.find(p=>p.id===rx.personId);
          if(rx.carePhase&&rx.carePhase!==(person?.carePhase||'prevention'))return [];
          const items=scheduleFor(rx,date,person);
          if(!familyDay)return items;
          // Named slots follow the plan day. Exact times keep their calendar dates and keys.
          const overnight=item=>(!item.anchor||item.anchor==='clock')&&item.time<familyDayStart;
          return [...items.filter(item=>!overnight(item)),...scheduleFor(rx,nextDay(date),person).filter(overnight)];
        });
        const items=planned.map(e=>({...e,event:state.events.find(x=>(x.key===e.key||x.key===e.legacyKey)&&x.status!=='void')||null}));
        const recorded=state.events.filter(e=>e.date===date&&e.status!=='void'&&(!personId||e.personId===personId)&&!items.some(p=>p.event?.id===e.id)).map(event=>({...event,event,historical:true}));
        const prn=prescriptions.filter(r=>(!r.carePhase||r.carePhase===(state.people.find(p=>p.id===r.personId)?.carePhase||'prevention'))&&r.type==='prn'&&!r.archived&&r.startDate<=date&&(!r.endDate||r.endDate>=date));
    return {items:[...items,...recorded].sort((a,b)=>(a.scheduledAt||a.occurredAt||'').localeCompare(b.scheduledAt||b.occurredAt||'')),prn};
  }
  const allowedHosts=new Set([publicHost,...additionalHosts,`medika.localhost:${port}`,`127.0.0.1:${port}`,`localhost:${port}`].flatMap(host=>host.includes(':')?[host.toLowerCase()]:[host.toLowerCase(),`${host.toLowerCase()}:80`,`${host.toLowerCase()}:443`]));
  async function rawBody(req,limit) {
    assert(!req.headers['content-length']||Number(req.headers['content-length'])<=limit,'Файл или запрос слишком большой',413);
    const chunks=[];let length=0;
    for await(const chunk of req) { length+=chunk.length;assert(length<=limit,'Файл или запрос слишком большой',413);chunks.push(chunk); }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function body(req,limit=18*1024*1024) {
    assert(req.headers['content-type']?.split(';')[0].trim().toLowerCase()==='application/json','Ожидается JSON',415);
    const raw=await rawBody(req,limit);
    try { const value=JSON.parse(raw);assert(value&&typeof value==='object'&&!Array.isArray(value),'Ожидается объект JSON');return value; } catch(e) { if(e instanceof InputError) throw e;throw new InputError('Некорректный JSON'); }
  }
  const server=http.createServer(async(req,res)=>{
    const send=(status,value,extra={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...extra});res.end(JSON.stringify(value));};
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      assert(allowedHosts.has(req.headers.host?.toLowerCase()),'Этот адрес не разрешён',403);
      const loopback=['127.0.0.1','::1'].includes(req.socket.remoteAddress);
      const scheme=req.headers['x-forwarded-proto']==='https'&&loopback?'https':'http';
      assert(req.url.startsWith('/'),'Некорректный адрес');
      const base=new URL(`${scheme}://${req.headers.host}`),url=new URL(req.url,base),route=url.pathname,method=req.method;
      assert(url.origin===base.origin,'Некорректный адрес');
      const redirect=(location,headers={})=>{res.writeHead(303,{Location:location,...headers});res.end();};
      if(auth){
        // Native form navigation sends Origin: null under no-referrer.
        if(loginPages.has(route))res.setHeader('Referrer-Policy','same-origin');
        res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
        res.setHeader('X-Frame-Options','DENY');
        res.setHeader('Cross-Origin-Resource-Policy','same-origin');
        res.setHeader('Permissions-Policy','microphone=(self), camera=(self), geolocation=()');
        assert(scheme==='https'&&base.host===publicHost,'Требуется HTTPS на адресе Медики',403);
        res.setHeader('Strict-Transport-Security','max-age=31536000');
      }
      if(route==='/design-study/a1')res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src ${url.origin}/api/session ${url.origin}/api/design-study/a1-snapshot; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
      if(['/design-study/round-2','/design-study/round-3','/design-study/round-4','/design-study/round-5','/design-study/round-6','/design-study/round-7','/design-study/round-8','/design-study/round-9','/design-study/round-10'].some(prefix=>route.startsWith(prefix)))res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
      // Links from chats may be cross-site; the shell and public CA contain no medical data.
      const publicRead=['GET','HEAD'].includes(method)&&(['/','/manage','/family','/family/','/voice-lab','/voice-lab/','/ocr-lab','/ocr-lab/','/playground','/prescriptions/import','/medika-ca.cer','/medicines','/medicines/'].includes(route)||Object.hasOwn(designStudyAssets,route)||auth&&accountPages.has(route)||google&&route===googleCallback);
      if(!publicRead){
        assert(!req.headers.origin||req.headers.origin===url.origin,'Запрос с другого сайта отклонён',403);
        assert(req.headers['sec-fetch-site']!=='cross-site','Запрос с другого сайта отклонён',403);
      }
      if(route==='/api/health'&&method==='GET') return send(200,auth?{ok:true}:{ok:true,app:'medika',version:'0.1.0',ocr:ocrReady});
      const session=auth?.session(req.headers.cookie);
      if(auth){
        if(route==='/api/account/providers'&&method==='GET'){
          return send(200,{google:!!google,linked:Boolean(google&&session&&auth.googleLinked(session.username))});
        }
        if(route==='/auth/google/start'&&method==='POST'){
          assert(google,'Вход через Google пока недоступен',404);
          assert(req.headers.origin===url.origin,'Запрос с другого сайта отклонён',403);
          const input=await body(req,4096);
          if(input.mode==='link')assert(session&&sameToken(session.csrf,req.headers['x-medika-token']),'Обновите страницу и повторите',403);
          const suppliedIp=req.headers['x-medika-client-ip'],ip=isIP(suppliedIp||'')?suppliedIp:req.socket.remoteAddress;
          const flow=await auth.prepareGoogle(input,ip,session);
          const {location,cookie}=google.start(flow);
          return send(200,{location},{'Set-Cookie':cookie});
        }
        if(google&&route===googleCallback&&method==='GET'){
          let flow;
          const clear=googleCookie('',0);
          const destination=()=>flow?.mode==='register'?'/register':flow?.mode==='link'?'/account':'/login';
          try{
            flow=google.take(req.headers.cookie,url.searchParams.get('state'));
            if(url.searchParams.has('error'))return redirect(destination()+'?google=cancelled',{'Set-Cookie':clear});
            const subject=await google.exchange(url.searchParams.get('code'),flow);
            const current=auth.session(req.headers.cookie);
            assert(flow.mode==='link'?current?.id===flow.sessionId:!current,'Запрос входа истёк',403);
            const secret=auth.finishGoogle(flow,subject);
            if(current)auth.logout(current.id);
            return redirect(flow.mode==='link'?'/account':'/family',{'Set-Cookie':[clear,sessionCookie(secret)]});
          }catch(error){
            if(!(error instanceof InputError))console.error('Ошибка входа через Google:',error.name);
            const reason=error.status===409?'conflict':error.status===401?'unlinked':error.status===403?'invalid':'unavailable';
            return redirect(destination()+'?google='+reason,flow?{'Set-Cookie':clear}:{});
          }
        }
        if(route==='/api/account/login-code'&&method==='POST'){
          assert(session&&req.headers.origin===url.origin&&sameToken(session.csrf,req.headers['x-medika-token']),'Войдите в Медику и обновите страницу',403);
          return send(201,{code:auth.createLoginCode(session.username,session.id)});
        }
        if((loginPages.has(route)||['/api/account/login','/api/account/register'].includes(route))&&method==='POST'){
          assert(req.headers.origin===url.origin,'Запрос с другого сайта отклонён',403);
          const suppliedIp=req.headers['x-medika-client-ip'],ip=isIP(suppliedIp||'')?suppliedIp:req.socket.remoteAddress;
          const nativeLogin=loginPages.has(route),codeLogin=route==='/login/code',login=nativeLogin||route.endsWith('/login');
          let input;
          if(nativeLogin){
            assert(req.headers['content-type']?.split(';')[0].trim().toLowerCase()==='application/x-www-form-urlencoded','Ожидается форма входа',415);
            const fields=new URLSearchParams(await rawBody(req,4096));
            input=codeLogin?fields.get('code'):{email:fields.get('email'),password:fields.get('password')};
          }else input=await body(req,4096);
          let secret;
          try{
            secret=codeLogin?auth.loginWithCode(input,ip):await (login?auth.login(input,ip):auth.register(input,ip));
          }catch(error){
            if(!nativeLogin||!(error instanceof InputError))throw error;
            const message=error.status===429?'Слишком много попыток. Попробуйте позже.'
              :codeLogin?'Код неверный, уже использован или истёк. Получите новый код.':'Проверьте email и пароль.';
            const html=await readFile(join(root,'public',accountPages.get(route)),'utf8');
            res.writeHead(error.status||400,{'Content-Type':'text/html; charset=utf-8'});
            return res.end(html.replace('<p id="account-error" role="alert"></p>',`<p id="account-error" role="alert">${message}</p>`));
          }
          if(session)auth.logout(session.id);
          const cookie={'Set-Cookie':sessionCookie(secret)};
          if(nativeLogin)return redirect('/family',cookie);
          return send(login?200:201,{ok:true},cookie);
        }
        if(!session){
          if(!['GET','HEAD'].includes(method)||route.startsWith('/api/'))throw new InputError('Войдите в Медику',401);
          if(!accountAssets.has(route)&&!loginPages.has(route)&&route!=='/register')return redirect('/login');
        }
        if(session&&(loginPages.has(route)||route==='/register'))return redirect('/family');
        if(route==='/api/account/logout'&&method==='POST'){
          assert(req.headers.origin===url.origin&&sameToken(session.csrf,req.headers['x-medika-token']),'Запрос с другого сайта отклонён',403);
          auth.logout(session.id);
          return send(200,{ok:true},{'Set-Cookie':sessionCookie('',0)});
        }
      }
      if(route==='/api/session'&&method==='GET') return session?send(200,{token:session.csrf,username:session.username}):send(200,{token},{'Set-Cookie':`medika_session=${token}; HttpOnly; SameSite=Strict; Path=/`});
      const ocrImageRoute=route.match(/^\/api\/ocr-lab\/cases\/([a-f\d-]+)\/(?:image|package-image\/m\d+-[a-f\d]{16})$/);
      const imageRoute=route.match(/^\/api\/documents\/([a-f\d-]+)\/image$/);
      const labAudioRoute=route.match(/^\/api\/voice-lab\/recordings\/([a-f\d-]+)\/audio$/);
      if(route.startsWith('/api/')) {
        const media=(imageRoute||ocrImageRoute||labAudioRoute)&&['GET','HEAD'].includes(method);
        const supplied=req.headers['x-medika-token'];
        if(auth){
          if(!['GET','HEAD'].includes(method))assert(req.headers.origin===url.origin,'Запрос с другого сайта отклонён',403);
          assert(media||sameToken(session.csrf,supplied),'Сессия обновлена. Перезагрузите страницу.',403);
        }else if(media)assert(req.headers.cookie?.split(';').some(s=>s.trim()===`medika_session=${token}`),'Откройте приложение перед просмотром',403);
        else assert(supplied===token,'Сессия обновлена. Перезагрузите страницу.',403);
      }
      if(route==='/api/design-study/a1-snapshot'){
        assert(method==='GET','Снимок доступен только для чтения',405);
        try{return send(200,JSON.parse(await readFile(join(dataDir,'design-study/a1-family.json'),'utf8')));}
        catch(error){if(error.code==='ENOENT')throw new InputError('Копия для демо ещё не подготовлена',404);throw error;}
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
      if(route==='/api/state'&&method==='GET') return send(200,{...store.state(),catalog,rules,reference:referenceInfo,capabilities:{ocr:ocrReady,ocrLanguages:['ru-RU','en-US'],notifications:'open-tab-only',entryParser:entryParser===parseWithCodex?await codexStatus():{model:'local-rules',cloud:false}}});
      if(route==='/api/parse-entry'&&method==='POST')return send(200,await entryParser(store.state(),await body(req)));
      if(['/api/transcribe','/api/record-entry'].includes(route)&&method==='POST')return send(410,{error:'Голосовой ввод отложен.'});
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
      if(route==='/api/ocr-lab'&&method==='GET')return send(200,{cases:await prescriptionLab.list(),demo:prescriptionLab.demo,ocr:ocrReady});
      if(route==='/api/ocr-lab/context'&&method==='GET')return send(200,{startDate:localParts(new Date(),'Europe/Chisinau').date,timeZone:'Europe/Chisinau',people:store.state().people.map(p=>({id:p.id,name:p.name,birthday:p.birthday,ageYears:p.ageYears,ageAsOf:p.ageAsOf,weight:p.weight,sourceVersion:p.version,carePhase:p.carePhase,selected:p.ageYears!=null&&p.ageYears<18,daySlots:{weekday:availableSlots(p,'weekday'),weekend:availableSlots(p,'weekend')}}))});
      if(route==='/api/ocr-lab/cases'&&method==='POST')return send(201,await prescriptionLab.create(await body(req)));
      const packImage=route.match(/^\/api\/ocr-lab\/cases\/([a-f\d-]+)\/package-image\/(m\d+-[a-f\d]{16})$/);if(packImage&&method==='GET'){const image=await prescriptionLab.packageImage(packImage[1],packImage[2]);res.writeHead(200,{'Content-Type':image.mime});return res.end(image.bytes);}
      const labCase=route.match(/^\/api\/ocr-lab\/cases\/([a-f\d-]+)(?:\/(image|package|events|apply|export))?$/);
      if(labCase){const [,id,action]=labCase;
        if(method==='GET'&&action==='image'){const image=await prescriptionLab.image(id);res.writeHead(200,{'Content-Type':image.mime});return res.end(image.bytes);}
        if(method==='DELETE'&&!action)return send(200,await prescriptionLab.remove(id));
        if(method==='GET'&&!action)return send(200,prescriptionLab.view(await prescriptionLab.read(id)));
        if(method==='GET'&&action==='export')return send(200,{format:'medika-prescription-test',version:1,...await prescriptionLab.read(id)});
        if(method==='PUT'&&!action)return send(200,await prescriptionLab.update(id,await body(req,1024*1024)));
        if(method==='POST'&&action==='package')return send(200,await prescriptionLab.package(id,await body(req)));
        if(method==='POST'&&action==='events')return send(200,await prescriptionLab.event(id,await body(req,10000)));
        if(method==='POST'&&action==='apply')return send(200,await applyPrescriptionPlan(store,uploads,prescriptionLab,id,await body(req,10000)));
      }
      if(route==='/api/people'&&method==='POST') return send(201,store.insert('people',personInput(await body(req))));
      const personRoute=route.match(/^\/api\/people\/([a-f\d-]+)$/);
      if(personRoute&&method==='PUT') { const input=await body(req),person=personInput(input);for(const rx of store.state().prescriptions.filter(r=>r.personId===personRoute[1]&&!r.archived))validateRoutineBinding(rx,person);return send(200,store.update('people',personRoute[1],person,input.version)); }
      if(route==='/api/medicines/recognize'&&method==='POST')return send(200,await medicineRecognition.recognize(await body(req,18*1024*1024)));
      if(route==='/api/medicines'&&method==='GET')return send(200,store.state().medicines);
      if(route==='/api/medicines'&&method==='POST'){
        const m=medicineInput(await body(req)),all=store.state().medicines,old=m.clientKey&&all.find(r=>r.clientKey===m.clientKey);
        validateMedicineSequence(m,all);if(old){assert(Object.keys(m).every(k=>JSON.stringify(m[k])===JSON.stringify(old[k])),'Этот ключ уже использован для другого лекарства',409);return send(200,old);}
        assert(!all.some(r=>medicineKey(r)===medicineKey(m)),'Такое лекарство уже есть в списке или архиве',409);const recognized=m.recognitionKey?await medicineRecognition.get(m.recognitionKey):null;let status=201;const saved=store.transaction(()=>{const current=store.state().medicines,found=m.clientKey&&current.find(r=>r.clientKey===m.clientKey);if(found){assert(Object.keys(m).every(k=>JSON.stringify(m[k])===JSON.stringify(found[k])),'Этот ключ уже использован для другого лекарства',409);status=200;return found;}assert(!current.some(r=>medicineKey(r)===medicineKey(m)),'Такое лекарство уже есть',409);const result=store.insert('medicines',{...m,...(recognized?{sourceText:recognized.text,sourceModel:recognized.model}:{})});if(recognized&&!store.state().medicinePhotos.some(p=>p.key===medicinePhotoKey(m.name)))store.insert('medicinePhotos',medicinePhotoInput({name:m.name,photos:recognized.photos}));return result;});return send(status,saved);
      }
      const medicineRoute=route.match(/^\/api\/medicines\/([a-f\d-]+)$/);
      if(medicineRoute&&method==='PUT'){
        const input=await body(req),m=medicineInput(input),old=store.get('medicines',medicineRoute[1]);assert(old,'Лекарство не найдено',404);validateMedicineSequence({...old,...m},store.state().medicines);assert(!store.state().medicines.some(r=>r.id!==medicineRoute[1]&&medicineKey(r)===medicineKey(m)),'Такое лекарство уже есть',409);if(!m.reference&&old?.reference&&old.reference.productKey!==medicineKey(m))m.reference=undefined;return send(200,store.update('medicines',medicineRoute[1],m,input.version));
      }
      if(route==='/api/prescriptions'&&method==='POST') {
        const input=await body(req),rx=rxInput(input);
        assert(store.get('people',input.personId),'Выберите человека');
        validateRoutineBinding(rx,store.get('people',input.personId));
        if(rx.documentId) assert(store.get('documents',rx.documentId)?.personId===input.personId,'Документ принадлежит другому человеку');
        if(rx.manualKey){const old=store.state().prescriptions.find(r=>r.manualKey===rx.manualKey);if(old){assert(old.personId===input.personId&&Object.keys(rx).every(k=>JSON.stringify(rx[k])===JSON.stringify(old[k])),'Этот ключ уже использован для другого назначения',409);return send(200,old);}}
        if(rx.medicineId){const m=store.get('medicines',rx.medicineId);assert(m&&!m.archived,'Лекарство недоступно');assert(input.medicineVersion===m.version,'Лекарство изменено. Откройте форму заново.',409);assert(rx.name===m.name&&rx.medicineForm===m.medicineForm&&rx.strength===m.strength,'Данные назначения не соответствуют выбранному лекарству');}
        return send(201,store.insert('prescriptions',{...rx,personId:input.personId,archived:false}));
      }
      const rxRoute=route.match(/^\/api\/prescriptions\/([a-f\d-]+)$/);
      if(rxRoute&&method==='PUT') {
        const input=await body(req),old=store.get('prescriptions',rxRoute[1]);assert(old,'Назначение не найдено',404);
        const rx=rxInput(input);
        validateRoutineBinding(rx,store.get('people',old.personId));
        if(rx.medicineId)assert(store.get('medicines',rx.medicineId),'Лекарство не найдено');
        if(rx.documentId) assert(store.get('documents',rx.documentId)?.personId===old.personId,'Документ принадлежит другому человеку');
        return send(200,store.update('prescriptions',old.id,{...rx,archived:input.archived===true},input.version));
      }
      const archiveRoute=route.match(/^\/api\/prescriptions\/([a-f\d-]+)\/archive$/);
      if(archiveRoute&&method==='POST') { const input=await body(req);return send(200,store.update('prescriptions',archiveRoute[1],{archived:input.archived!==false},input.version)); }
      if(route==='/api/schedule'&&method==='GET'){const date=day(url.searchParams.get('date'));return send(200,scheduleView(store.state(),date,url.searchParams.get('personId')));}
      if(route==='/api/family'&&method==='GET'){
        const now=new Date(),timeZone='Europe/Chisinau',local=localParts(now,timeZone);
        const date=local.time<familyDayStart?nextDay(local.date,-1):local.date;
        const dayEndsAt=zonedInstant(nextDay(date),familyDayStart,timeZone),state=store.state();
        const view=familyView(state,scheduleView(state,date,'',true),{date,now,timeZone},{maskIds:false});
        return send(200,{...view,courseSupply:courseSupply(state,{date,now}),dayEndsAt,account:Boolean(auth),medicinePhotos:state.medicinePhotos,medicines:state.medicines.filter(m=>!m.archived)});
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
        assert(input.rxVersion===undefined||input.rxVersion===rx.version,'Назначение изменилось. Обновите расписание перед отметкой.',409);
        assert(!rx.carePhase||rx.carePhase===(store.get('people',rx.personId)?.carePhase||'prevention'),'Назначение относится к другой фазе лечения');
        assert(['taken','skipped','deferred'].includes(input.status),'Неизвестный статус');
        const occurrence=occurrenceInput({personId:rx.personId,timeZone:rx.timeZone,occurredAt:input.timeUnknown===true?(input.occurredAt??null):input.occurredAt||new Date().toISOString(),...(input.timeUnknown===true?{timeUnknown:true,knownDate:input.knownDate}:{timeUnknown:false})}),occurredAt=occurrence.occurredAt;
        const date=rx.type==='prn'?(occurrence.timeUnknown?occurrence.knownDate:localParts(occurredAt,rx.timeZone).date):day(input.date),event=rx.type==='prn'?null:scheduleFor(rx,date,store.get('people',rx.personId)).find(e=>e.key===input.key);
        assert(event||rx.type==='prn'&&!rx.archived&&date>=rx.startDate&&(!rx.endDate||date<=rx.endDate),'Событие отсутствует в действующем расписании');
        assert(rx.type!=='prn'||input.status==='taken','Для приёма по необходимости записывается факт');
        const manualClientKey=rx.type==='prn'&&input.clientKey?string(input.clientKey,'Ключ ручной отметки',120,true):'';
        if(manualClientKey){assert(/^[a-zA-Z0-9_-]{8,120}$/.test(manualClientKey),'Некорректный ключ отметки');const previous=store.state().events.find(e=>e.rxId===rx.id&&e.manualClientKey===manualClientKey);if(previous){assert(previous.status==='taken'&&previous.actualDose===positive(input.dose??rx.dose,'Фактическая доза'),'Ключ относится к другой отметке',409);return send(200,previous);}}
        const key=event?.key||`${rx.id}@prn-${newId()}`;
        if(event?.legacyKey){const legacy=store.db.prepare('SELECT data FROM events WHERE event_key=?').get(event.legacyKey);assert(!legacy||JSON.parse(legacy.data).status==='void','Этот приём уже отмечен по прежнему расписанию',409);}
        const old=store.db.prepare('SELECT data FROM events WHERE event_key=?').get(key);
        assert(!old||JSON.parse(old.data).status==='void','Этот приём уже отмечен. Обновите расписание.',409);
        const actualDose=input.status==='taken'?positive(input.dose??rx.dose,'Фактическая доза'):rx.dose;if(input.status==='taken'&&['впрыскивание','кап.'].includes(rx.unit))assert(Number.isInteger(Number(actualDose)),'Капли и впрыскивания: целое количество');
        const record={...(event||{rxId:rx.id,personId:rx.personId,name:rx.name,dose:rx.dose,unit:rx.unit,timeZone:rx.timeZone,conditions:rx.conditions,ingredients:rx.ingredients,date,time:occurrence.timeUnknown?'':localParts(occurredAt,rx.timeZone).time,...(rx.doseScope?{doseScope:rx.doseScope}:{}),...(rx.purpose?{purpose:rx.purpose}:{}),...(rx.carePhase!==undefined?{carePhase:rx.carePhase}:{})}),key,...(manualClientKey?{manualClientKey}:{}),status:input.status,...occurrence,actualDose,note:string(input.note||procedureNote(rx),'Примечание',2000),author:string(input.author||'Я','Автор',100)};
        for(const field of ['legacyKey','anchor','label','displayTime','relation','slotIndex'])delete record[field];
        if(old) {const previous=JSON.parse(old.data);return send(200,store.update('events',previous.id,record,previous.version));}
        return send(201,store.insert('events',record));
      }
      const correctRoute=route.match(/^\/api\/(events|activities|temperatures)\/([a-f\d-]+)\/correct$/);
      if(correctRoute&&method==='POST'){
        const [,table,id]=correctRoute,input=await body(req),old=store.get(table,id);assert(old,'Запись не найдена',404);assert(old.status!=='void','Запись уже отменена',409);assert(old.version===input.version,'Запись уже изменена. Обновите журнал.',409);
        const occurrence=occurrenceInput({personId:old.personId,timeZone:old.timeZone,...(input.timeUnknown===true?{timeUnknown:true,knownDate:input.knownDate,occurredAt:input.occurredAt??null}:{timeUnknown:false,occurredAt:input.occurredAt})});
        let patch;if(table==='events'){assert(old.status==='taken','Исправляется фактический приём');patch={...occurrence,actualDose:positive(input.amount,'Фактическая доза'),note:string(input.note??old.note,'Примечание',2000)};}
        else if(table==='temperatures')patch=temperatureInput({...old,...occurrence,celsius:input.celsius});
        else patch=activityInput({...old,...occurrence,...Object.fromEntries(['celsius','amount','unit','name','note','minHours'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]))});
        if(table==='events'&&['впрыскивание','кап.'].includes(old.unit))assert(Number.isInteger(Number(patch.actualDose)),'Капли и впрыскивания: целое количество');
        return send(200,store.update(table,id,patch,input.version));
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
          const result=await recognize(bytes);text=result.text;lines=result.lines;
          await writeFile(join(uploads,id),bytes,{mode:0o600});
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
        return send(200,{...state,format:'medika-backup',version:5,exportedAt:new Date().toISOString(),images,audit:store.history()},{'Content-Disposition':`attachment; filename="medika-backup-${new Date().toISOString().slice(0,10)}.json"`});
      }
      if(route==='/api/restore'&&method==='POST') return send(200,await restoreBackup(store,uploads,await body(req,64*1024*1024),imageType));
      if(route==='/api/audit'&&method==='GET') return send(200,store.history().slice(-200).reverse());
      assert(!route.startsWith('/api/'),'Метод или маршрут не найден',404);
      assert(method==='GET'||method==='HEAD','Метод не разрешён',405);
      if(route==='/medika-ca.cer'&&method==='GET'&&!auth){res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename=medika-ca.cer'});return res.end(await readFile(join(root,'data/medika-ca.cer')));}
      if(route==='/ocr-sample.png'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(await readFile(join(root,'public/ocr-sample.png')));}
      const packageImage=route.match(/^\/medicine-images\/([a-z0-9-]+\.jpg)$/);if(packageImage){let bytes;try{bytes=await readFile(join(root,'public/medicine-images',packageImage[1]));}catch{throw new InputError('Фото не найдено',404);}res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=86400'});return res.end(method==='HEAD'?undefined:bytes);}
      const assets={...designStudyAssets,'/intake-timer.js':['intake-timer.js','text/javascript'],'/medicines':['medicines.html','text/html'],'/medicines/':['medicines.html','text/html'],'/medicine-reference.js':['medicine-reference.js','text/javascript'],'/medicine-reference.css':['medicine-reference.css','text/css'],'/medicines.js':['medicines.js','text/javascript'],'/medicines.css':['medicines.css','text/css'],'/family':['family-preview.html','text/html'],'/family/':['family-preview.html','text/html'],'/family-preview-model.js':['family-preview-model.js','text/javascript'],'/family-card.js':['family-card.js','text/javascript'],'/ocr-lab':['ocr-lab.html','text/html'],'/ocr-lab/':['ocr-lab.html','text/html'],'/playground':['ocr-lab.html','text/html'],'/prescriptions/import':['ocr-lab.html','text/html'],'/ocr-lab.js':['ocr-lab.js','text/javascript'],'/prescription-workspace.js':['prescription-workspace.js','text/javascript'],'/prescription-workspace.css':['prescription-workspace.css','text/css'],'/medicine-forms.js':['medicine-forms.js','text/javascript'],'/routine.js':['routine.js','text/javascript'],'/':['family-preview.html','text/html'],'/manage':['index.html','text/html'],'/family-workspace.js':['family-workspace.js','text/javascript'],'/family-workspace.css':['family-workspace.css','text/css'],'/voice-lab':['voice-lab.html','text/html'],'/voice-lab/':['voice-lab.html','text/html'],'/voice-lab.js':['voice-lab.js','text/javascript'],'/voice-lab.css':['voice-lab.css','text/css'],'/prescription-summary.js':['prescription-summary.js','text/javascript'],'/medicine-images.js':['medicine-images.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/icon.svg':['icon.svg','image/svg+xml'],'/voice-recorder.js':['voice-recorder.js','text/javascript'],'/voice-capture.js':['voice-capture.js','text/javascript'],'/voice-draft-cleanup.js':['voice-draft-cleanup.js','text/javascript']};
      const asset=auth&&accountPages.has(route)?[accountPages.get(route),'text/html']:auth&&accountAssets.has(route)?[route.slice(1),accountAssets.get(route)]:Object.hasOwn(assets,route)?assets[route]:null;
      assert(asset&&['GET','HEAD'].includes(method),'Страница не найдена',404);
      const [file,mime]=asset;res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`});res.end(method==='HEAD'?undefined:await readFile(join(root,'public',file)));
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
  const port=Number(process.env.PORT||4382),additionalHosts=(process.env.MEDIKA_LAN_HOSTS||'').split(',').map(host=>host.trim()).filter(Boolean);
  const publicHost=process.env.MEDIKA_PUBLIC_HOST?.toLowerCase(),app=await createApp({
    port,additionalHosts,publicHost,requireAccount:Boolean(publicHost),...(publicHost?{}:{entryParser:parseWithCodex}),
    dataDir:process.env.MEDIKA_DATA_DIR||join(root,'data'),
    googleOptions:{clientId:process.env.MEDIKA_GOOGLE_CLIENT_ID,clientSecret:process.env.MEDIKA_GOOGLE_CLIENT_SECRET}
  });
  app.server.listen(port,'127.0.0.1',()=>console.log('Медика: http://medika.localhost'+additionalHosts.map(host=>` · http://${host}`).join('')));
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await app.close();process.exit(0);});
}
