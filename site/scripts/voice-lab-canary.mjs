import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {parseEntry} from '../lib/entry-parser.mjs';
import {parseWithCodex} from '../lib/codex-parser.mjs';
import {InputError} from '../lib/domain.mjs';
import {encodeWav} from '../public/voice-capture.js';
const exec=promisify(execFile),{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright'),real=process.env.MEDIKA_TEST_AI==='1';
const dir=await mkdtemp(join(tmpdir(),'medika-lab-ui-')),data=join(dir,'data'),reports=join(dirname(fileURLToPath(import.meta.url)),'../../reports'),port=14395,origin=`http://127.0.0.1:${port}`,publicOrigin=process.env.MEDIKA_PUBLIC_PREVIEW_ORIGIN||origin;
let app,browser,token,failNext=false,parseCalls=0,modelCalls=0;const checks=[],errors=[];let stateAfter;
const options={...(real?{}:{availability:async()=>({medium:true,small:true,codex:true}),transcribe:async()=>({text:'Даня, две минуты назад температура 38,2'})}),parse:async(state,input,options)=>{parseCalls++;if(failNext)throw new InputError('Тестовый лимит: очередь остановлена',429);if(real)modelCalls++;return real?parseWithCodex(state,input,options):parseEntry(state,input);}};
async function start(){app=await createApp({dataDir:data,port,voiceLabOptions:options});await new Promise(r=>app.server.listen(port,'127.0.0.1',r));token=(await(await fetch(origin+'/api/session')).json()).token;}
async function api(path){const r=await fetch(origin+'/api'+path,{headers:{'X-Medika-Token':token}});assert.equal(r.status,200);return r.json();}
function check(text){checks.push(text);console.log('PASS '+text);}
async function resultCount(page,n){await page.waitForFunction(n=>document.querySelectorAll('.result .verdict').length===n||document.querySelector('.result .error'),n,{timeout:150000});assert.equal(await page.locator('.result .error').count(),0,await page.locator('.result .error').allTextContents());}
async function report(status){await writeFile(join(reports,'voice-lab-canary.json'),JSON.stringify({status,completedAt:new Date().toISOString(),checks,errors,syntheticDataOnly:true,realWhisperAndCodex:real,assetsOrigin:publicOrigin,physicalDeviceTested:false,parseAttempts:parseCalls,modelCalls},null,2));}
try{
  const phrase='Даня, две минуты назад температура тридцать восемь и два.';
  await exec('/usr/bin/say',['-v','Milena','-o',join(dir,'speech.aiff'),phrase]);await exec('/usr/bin/afconvert',['-f','WAVE','-d','LEI16@16000','-c','1',join(dir,'speech.aiff'),join(dir,'speech.wav')]);
  const wav=await readFile(join(dir,'speech.wav'));let offset=12,pcm;
  while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}assert.ok(pcm);
  const floats=new Float32Array(pcm.length/2);for(let i=0;i<floats.length;i++)floats[i]=pcm.readInt16LE(i*2)/32768;const duration=floats.length/16000;
  await writeFile(join(dir,'speech.wav'),Buffer.from(await encodeWav([floats,new Float32Array(96000)],16000).arrayBuffer()));
  await start();const before=await api('/backup');
  browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+join(dir,'speech.wav')]});
  const context=await browser.newContext({viewport:{width:390,height:844},ignoreHTTPSErrors:true,permissions:['microphone'],timezoneId:'Europe/Chisinau'});await context.addInitScript(()=>{if(!localStorage.getItem('voice-lab-variants'))localStorage.setItem('voice-lab-variants',JSON.stringify(['base-terra','small-terra']));});const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  if(publicOrigin!==origin)await page.route('**/api/**',async route=>{const r=route.request(),u=new URL(r.url()),headers={...r.headers()};delete headers.origin;delete headers.host;delete headers['sec-fetch-site'];const response=await fetch(origin+u.pathname+u.search,{method:r.method(),headers,body:r.postData()||undefined});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
  await page.route('https://voice-lab-source.invalid/',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:`<a href="${publicOrigin}/voice-lab">Открыть проверку</a>`}));await page.goto('https://voice-lab-source.invalid/');await page.getByRole('link',{name:'Открыть проверку',exact:true}).click();await page.getByRole('heading',{name:'Прочитайте фразу',exact:true}).waitFor();assert.equal(await page.locator('[data-variant]').count(),5);assert.equal(await page.locator('[data-variant="base-terra"]').count(),0);assert.equal(await page.locator('[data-variant="medium-terra"]').isChecked(),true);check('Внешняя ссылка открывает тестовую страницу с шестью фразами и пятью вариантами');
  await page.getByRole('button',{name:'● Записать голос',exact:true}).click();await page.getByRole('button',{name:'■ Сохранить запись',exact:true}).waitFor();await page.waitForTimeout(duration*1000+2200);assert.equal(await page.getByRole('button',{name:'■ Сохранить запись',exact:true}).count(),1);await page.getByRole('button',{name:'■ Сохранить запись',exact:true}).click();await page.locator('audio').waitFor();
  const saved=(await api('/voice-lab')).recordings[0];assert.ok(saved);assert.equal(saved.phraseId,'temperature');check('Микрофон без автообрыва по паузе → сохранённый WAV и прослушивание');
  const playback=await fetch(origin+`/api/voice-lab/recordings/${saved.id}/audio`,{headers:{Cookie:'medika_session='+token,Range:'bytes=0-1'}});assert.equal(playback.status,206);assert.equal((await playback.arrayBuffer()).byteLength,2);
  await page.locator('[data-variant="small-terra"]').uncheck();await page.locator('[data-act="compare"]').click();await resultCount(page,1);const first=(await api('/voice-lab')).recordings[0].results['medium-terra'];assert.equal(first.audioSha256,saved.audioSha256);
  await page.locator('[data-result="medium-terra"] [data-verdict="correct"]').click();await page.locator('[data-result="medium-terra"] [data-verdict="correct"][aria-pressed="true"]').waitFor();await app.close();await start();await page.reload();await page.locator('[data-result="medium-terra"] .verdict').waitFor();assert.equal((await api('/voice-lab')).recordings[0].results['medium-terra'].verdict,'correct');check('Результат и оценка сохраняются после перезапуска; первый вариант не пересчитывается');
  await report('CANARY_PASS');
  for(const id of ['small-terra','medium-sol','small-sol','small-luna'])await page.locator(`[data-variant="${id}"]`).check();await page.locator('[data-act="compare"]').click();await resultCount(page,5);
  for(const id of ['medium-terra','small-terra','medium-sol','small-sol','small-luna']){const card=page.locator(`[data-result="${id}"]`);assert.equal(await card.locator('textarea[readonly]').count(),2);assert.equal(await card.getByLabel('Распознал Whisper',{exact:true}).inputValue(),(await api('/voice-lab')).recordings[0].results[id].transcript);assert.match(await card.getByLabel('Поняла модель',{exact:true}).inputValue(),/Даня: Температура — 38,2 °C[.]/);assert.match(await card.getByLabel('Поняла модель',{exact:true}).inputValue(),/Когда: 2 мин назад/);}
  check('В каждом результате два текстовых поля: исходный Whisper и смысл из полей модели');
  stateAfter=(await api('/voice-lab')).recordings[0];assert.equal(parseCalls,5);assert.equal(new Set(Object.values(stateAfter.results).map(r=>r.audioSha256)).size,1);assert.equal(Object.keys(stateAfter.transcripts).length,2);assert.equal(stateAfter.results['medium-sol'].asrCached,true);check('Пять вариантов, одна запись, два общих ASR, три модели смысла low; готовый canary переиспользован');
  for(const width of [320,390,768,1024,1470]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if([390,1024].includes(width))await page.screenshot({path:join(reports,'voice-lab-'+width+'.png'),fullPage:true});}check('Все варианты на одной странице: 320/390/768/1024/1470 без горизонтального скролла');
  failNext=true;await page.locator('#audio-file').setInputFiles(join(dir,'speech.wav'));await page.waitForFunction(old=>document.querySelector('#saved').value!==old,saved.id);await page.locator('[data-act="compare"]').click();await page.locator('.result .error').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-act="compare"]').disabled);assert.equal(parseCalls,6);assert.equal(Object.keys((await api('/voice-lab')).recordings[0].results).length,1);check('Лимит первого запроса останавливает оставшуюся очередь без повторов и смены провайдера');
  const after=await api('/backup');for(const key of ['people','documents','prescriptions','events','temperatures','activities','audit'])assert.deepEqual(after[key],before[key]);assert.deepEqual(errors,[]);check('В клинических разделах и журнале нет изменений от тестов');await report('PASS');
}catch(error){console.error(error);errors.push(error.message);await report('FAIL');process.exitCode=1;}
finally{await browser?.close();await app?.close();await rm(dir,{recursive:true,force:true});}
