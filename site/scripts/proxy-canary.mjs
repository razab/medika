import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=join(dirname(fileURLToPath(import.meta.url)),'../..'),temporary=await mkdtemp(join(tmpdir(),'medika-proxy-'));
const origin='http://medika.localhost:18080',port=14384;
let app,browser,proxy,logs='';const errors=[];
async function start(){app=await createApp({dataDir:join(temporary,'data'),port,publicHost:'medika.localhost:18080'});await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));}
async function ready(){for(let i=0;i<40;i++){try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(400)});if(r.ok&&(await r.json()).app==='medika')return;}catch{}if(proxy?.exitCode!=null)throw Error(logs);await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Proxy readiness failed: '+logs);}
try{
  await start();
  const snippet=(await readFile(join(root,'infra/medika.caddy'),'utf8')).replace('http://medika.localhost','http://medika.localhost:18080').replace('127.0.0.1:4382','127.0.0.1:14384');
  const config=join(temporary,'Caddyfile');await writeFile(config,'{\n auto_https off\n admin off\n default_bind 127.0.0.1\n}\n'+snippet);
  proxy=spawn('/opt/homebrew/bin/caddy',['run','--config',config,'--adapter','caddyfile'],{stdio:['ignore','ignore','pipe']});proxy.stderr.on('data',chunk=>logs=(logs+chunk).slice(-4096));await ready();
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1470,height:918}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('button',{name:'Добавить первого человека',exact:true}).click();await page.locator('dialog input[name="name"]').fill('Прокси · тест');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.locator('dialog').waitFor({state:'hidden'});await page.locator('.family-board').waitFor();assert.match(await page.locator('.family-board').innerText(),/Прокси · тест/);
  const token=(await(await fetch(origin+'/api/session')).json()).token;const state=await(await fetch(origin+'/api/state',{headers:{'X-Medika-Token':token,Origin:origin}})).json();assert.equal(state.people.length,1);
  const forbidden=await fetch(origin+'/api/state',{headers:{'X-Medika-Token':token,Origin:'https://example.com'}});assert.equal(forbidden.status,403);
  await app.close();await start();await ready();await page.reload();await page.locator('.family-board').waitFor();assert.match(await page.locator('.family-board').innerText(),/Прокси · тест/);assert.deepEqual(errors,[]);
  await writeFile(join(root,'reports/proxy-canary.json'),JSON.stringify({status:'PASS',verifiedAt:new Date().toISOString(),checks:['Caddy reverse proxy with preserved Host','Browser UI and relative assets','Session cookie and authenticated API','Foreign Origin rejected','SQLite survives backend restart','Browser reopens through proxy without JS errors'],syntheticDataOnly:true},null,2));console.log('PASS: Caddy → приложение → браузер/API → сохранение → перезапуск');
}finally{
  await browser?.close();
  if(proxy&&proxy.exitCode==null){proxy.kill('SIGTERM');await once(proxy,'exit');}
  await app?.close().catch(()=>{});await rm(temporary,{recursive:true,force:true});
}
