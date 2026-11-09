// Read-only UI checks. The gallery has no connection to the clinical API.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.env.MEDIKA_DESIGN_ORIGIN||'http://192.168.0.38';
const b=await chromium.launch({headless:true}),p=await b.newPage({viewport:{width:1360,height:900}}),errors=[],requests=[],results=[];
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));
const ids=['a1','a2','a3','b1','b2','b3','c1','c2','c3'];
const inspect=()=>p.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,fontLoaded:[...document.querySelectorAll('.mock')].every(e=>document.fonts.check('16px '+getComputedStyle(e).fontFamily.split(',')[0])),firstDrug:document.querySelector('.mock h3')?.getBoundingClientRect().top,clipped:[...document.querySelectorAll('.mock h3,.mock .dose')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)}));
try{
  for(const route of ['/design-study',...ids.map(id=>'/design-study/'+id)])assert.equal((await fetch(origin+route,{headers:{Origin:'https://chat.example','Sec-Fetch-Site':'cross-site'}})).status,200,route);
  await p.goto(origin+'/design-study');await p.evaluate(()=>document.fonts.ready);assert.equal(await p.locator('.study').count(),9);
  for(const group of ['frontend','pro','baseline'])await p.locator('#'+group).screenshot({path:'reports/design-study-'+group+'.png'});
  for(const id of ids)for(const width of [320,390,768,1024]){
    await p.setViewportSize({width,height:844});await p.goto(origin+'/design-study/'+id);await p.evaluate(()=>document.fonts.ready);
    const text=await p.locator('.mock').innerText();for(const value of ['Алиса','Даня','ТестСироп','ТестСпрей','ТестТаблетки','ТестРаствор','19:00','21:30','2,5 мл','1 впрыскивание','37,4 °C','4 капли'])assert.ok(text.includes(value),id+' missing '+value);
    const result=await inspect();assert.equal(result.overflow,false,id+' overflow '+width);assert.deepEqual(result.clipped,[],id+' clipped '+width);assert.ok(result.firstDrug<420,id+' drug below fold');assert.ok(result.fontLoaded);results.push({id,width,...result});
    if(width===390||id==='b3'&&width===768)await p.screenshot({path:'reports/design-study-'+id+'-'+width+'.png',fullPage:true});
    if(width===390){await p.getByRole('link',{name:'Следующий',exact:true}).click();assert.ok(p.url().endsWith(ids[(ids.indexOf(id)+1)%ids.length]));}
  }
  for(const width of [320,390,768,1024,1360]){
    await p.setViewportSize({width,height:1024});await p.goto(origin+'/design-study');await p.evaluate(()=>document.fonts.ready);const result=await inspect();assert.equal(result.overflow,false,'gallery '+width);assert.deepEqual(result.clipped,[],'gallery clipped '+width);results.push({gallery:true,width,...result});
    if(width===768)await p.screenshot({path:'reports/design-study-gallery-768.png',fullPage:true});
  }
  await p.getByRole('link',{name:'Открыть',exact:true}).first().click();await p.getByRole('link',{name:'Все варианты',exact:true}).click();assert.equal(await p.locator('.study').count(),9);
  assert.equal(requests.filter(u=>new URL(u).pathname.startsWith('/api/')).length,0);assert.deepEqual(errors,[]);
  await writeFile('reports/design-study-check.json',JSON.stringify({status:'PASS',completedAt:new Date().toISOString(),syntheticOnly:true,physicalIPadTested:false,clinicalApiRequests:0,results,errors},null,2));console.log('PASS: 9 designs × 4 widths, gallery × 5 widths, navigation, fonts, cross-site links, zero API requests.');
}finally{await b.close();}
