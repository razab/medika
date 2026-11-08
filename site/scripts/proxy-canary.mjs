import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir,networkInterfaces} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=join(dirname(fileURLToPath(import.meta.url)),'../..'),temporary=await mkdtemp(join(tmpdir(),'medika-proxy-'));
const origin='http://medika.localhost:18080',port=14384;
const lanIP=networkInterfaces().en0?.find(address=>address.family==='IPv4')?.address;
assert.ok(lanIP,'Wi-Fi IPv4 is required for the LAN canary');
const lanOrigin=`http://${lanIP}:18080`;
let app,browser,proxy,logs='';const errors=[];
async function start(){app=await createApp({dataDir:join(temporary,'data'),port,publicHost:'medika.localhost:18080',additionalHosts:[`${lanIP}:18080`,'macbook-air-5.local:18080']});await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));}
async function launch(config){proxy=spawn('/opt/homebrew/bin/caddy',['run','--config',config,'--adapter','caddyfile'],{stdio:['ignore','ignore','pipe']});proxy.stderr.on('data',chunk=>logs=(logs+chunk).slice(-4096));await ready();}
async function stopProxy(){if(proxy&&proxy.exitCode==null){proxy.kill('SIGTERM');await once(proxy,'exit');}}
async function ready(){for(let i=0;i<40;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(400)});if(r.ok&&(await r.json()).app==='medika')return;}catch{}if(proxy?.exitCode!=null)throw Error(logs);await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Proxy readiness failed: '+logs);}
try{
  await start();
  const snippet=(await readFile(join(root,'infra/medika.caddy'),'utf8')).replace(/http:\/\/([a-z\d.-]+)(?=[,\s{])/g,'http://$1:18080').replaceAll('127.0.0.1:4382','127.0.0.1:14384');
  assert.ok(snippet.includes(lanOrigin),'Update the LAN address in infra/medika.caddy before testing');
  const config=join(temporary,'Caddyfile'),prefix='{\n auto_https off\n admin off\n}\n';await writeFile(config,prefix+snippet);await launch(config);
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1024,height:768},hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(lanOrigin);await page.getByRole('button',{name:'Добавить первого человека',exact:true}).click();await page.locator('dialog input[name="name"]').fill('Прокси · тест');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});await page.locator('.family-board').waitFor({state:'attached'});assert.match(await page.locator('.family-board').textContent(),/Прокси · тест/);
  assert.ok((await page.context().cookies()).some(cookie=>cookie.name==='medika_session'&&cookie.httpOnly));
  const token=(await(await fetch(lanOrigin+'/api/session')).json()).token;const state=await(await fetch(lanOrigin+'/api/state',{headers:{'X-Medika-Token':token,Origin:lanOrigin}})).json();assert.equal(state.people.length,1);
  const forbidden=await fetch(lanOrigin+'/api/state',{headers:{'X-Medika-Token':token,Origin:'https://example.com'}});assert.equal(forbidden.status,403);
  await app.close();await start();await ready();await page.reload();await page.locator('.family-board').waitFor({state:'attached'});assert.match(await page.locator('.family-board').textContent(),/Прокси · тест/);assert.deepEqual(errors,[]);
  await stopProxy();await writeFile(config,prefix+snippet.replace('192.168.0.0/24','192.0.2.0/24'));await launch(config);
  assert.equal((await fetch(lanOrigin+'/api/session',{headers:{'X-Forwarded-For':'127.0.0.1'}})).status,403);
  assert.equal((await fetch(origin+'/api/health')).status,200);
  await writeFile(join(root,'reports/proxy-canary.json'),JSON.stringify({status:'PASS',verifiedAt:new Date().toISOString(),checks:['Caddy reverse proxy with preserved Host','LAN-IP browser UI and relative assets at tablet width','Session cookie and authenticated API','Foreign Origin rejected','SQLite survives backend restart','Browser reopens through proxy without JS errors','Disallowed source subnet rejected despite forged X-Forwarded-For','Original localhost route still works'],syntheticDataOnly:true,physicalIPadTested:false},null,2));console.log('PASS: LAN-IP → Caddy → браузер/API → сохранение → перезапуск; чужая подсеть отклонена');
}finally{
  await browser?.close();
  await stopProxy();
  await app?.close().catch(()=>{});await rm(temporary,{recursive:true,force:true});
}
