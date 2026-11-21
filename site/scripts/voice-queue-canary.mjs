import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const dataDir=await mkdtemp(join(tmpdir(),'medika-retired-voice-'));
const port=14414,origin=`http://127.0.0.1:${port}`;
const app=await createApp({dataDir,port});
let browser;
try{
  await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
  const {token}=await fetch(origin+'/api/session').then(response=>response.json());
  async function api(path,body){
    const response=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{'X-Medika-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const data=await response.json();
    assert.ok(response.ok,JSON.stringify(data));
    return data;
  }
  const person=await api('/people',{name:'Тест'});
  await api('/activities',{personId:person.id,kind:'temperature',celsius:'37.2',occurredAt:new Date().toISOString(),timeZone:'Europe/Chisinau',clientKey:'saved-before-retirement'});
  const before=(await api('/state')).activities;
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const oldTab=await context.newPage();
  await oldTab.route(origin+'/old-tab',route=>route.fulfill({contentType:'text/html',body:'<title>Voice migration fixture</title>'}));
  await oldTab.goto(origin+'/old-tab');
  await oldTab.evaluate(async()=>{
    const seed=(name,rows)=>new Promise((resolve,reject)=>{
      const request=indexedDB.open(name,1);
      request.onerror=()=>reject(request.error);
      request.onupgradeneeded=()=>{
        const store=request.result.createObjectStore('jobs',{keyPath:'sequence',autoIncrement:true});
        rows.forEach(row=>store.add(row));
      };
      request.onsuccess=()=>resolve(request.result);
    });
    window.oldVoiceConnection=await seed('medika-voice-queue',[
      {id:'test-audio',state:'queued',audio:new Blob(['synthetic audio'])},
      {id:'test-transcript',state:'review',text:'synthetic transcript'},
    ]);
    (await seed('unrelated-fixture',[{text:'preserve me'}])).close();
  });

  const page=await context.newPage(),unexpected=[];
  context.on('request',request=>{
    if(/\/api\/(transcribe|record-entry)$/.test(request.url()))unexpected.push(request.url());
  });
  await page.goto(origin+'/family');
  await page.locator('.family-preview-footer').waitFor();
  assert.equal(await page.locator('[data-voice],[data-voice-queue]').count(),0);
  await page.getByRole('button',{name:'Ещё',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Голосовой ввод',exact:true}).count(),0);
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Вручную',exact:true}).click();
  await page.locator('#event-form').waitFor();
  await oldTab.close();
  await page.waitForFunction(async()=>!(await indexedDB.databases()).some(db=>db.name==='medika-voice-queue'));
  assert.ok(await page.evaluate(async()=>(await indexedDB.databases()).some(db=>db.name==='unrelated-fixture')));
  await page.goto(origin+'/manage');
  await page.locator('.patient-app').waitFor();
  assert.equal(await page.locator('[data-act=voice],#language').count(),0);
  const textButton=page.getByRole('button',{name:'Текстом',exact:true});
  assert.ok(await textButton.isVisible());
  const target=await textButton.boundingBox();
  assert.ok(target.width>=48&&target.height>=48);
  assert.deepEqual(unexpected,[]);
  assert.deepEqual((await api('/state')).activities,before);
  console.log('PASS old voice drafts deleted after the old tab closes, zero processing requests, unrelated storage and journal preserved');
}finally{
  await browser?.close();
  await app.close();
  await rm(dataDir,{recursive:true,force:true});
}
