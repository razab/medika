// Read-only UI checks. The gallery has no connection to the clinical API.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const origin=process.env.MEDIKA_DESIGN_ORIGIN||'http://192.168.0.38';
const b=await chromium.launch({headless:true}),p=await b.newPage({viewport:{width:1360,height:900},hasTouch:true}),errors=[],requests=[],results=[];
p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));
const ids=['a1','a2','b1','b2','b3','c1','c2','c3'];
const inspect=()=>p.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,fontLoaded:[...document.querySelectorAll('.mock')].every(e=>document.fonts.check('16px '+getComputedStyle(e).fontFamily.split(',')[0])),firstDrug:document.querySelector('.mock [data-drug-name],.mock h3')?.getBoundingClientRect().top,clipped:[...document.querySelectorAll('.mock h3,.mock .dose,.care-med-name,.care-dose')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent)}));
const touchGeometry=()=>p.evaluate(()=>{
  const targets=[...document.querySelectorAll('.a1 .care-family label,.a1 summary,.a1 .care-take,.a1 .voice,.a1 .write,.single .review-nav a')].map((e,index)=>{const r=e.getBoundingClientRect();return {index,name:e.textContent.trim()||e.querySelector('input')?.getAttribute('aria-label')||e.className,x:r.x,y:r.y,width:r.width,height:r.height};}).filter(r=>r.width>0&&r.height>0);
  const undersized=targets.filter(r=>r.width<47.9||r.height<47.9),crowded=[];
  let minGap=Infinity;
  for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++){
    const a=targets[i],b=targets[j],dx=Math.max(0,a.x-b.x-b.width,b.x-a.x-a.width),dy=Math.max(0,a.y-b.y-b.height,b.y-a.y-a.height),distance=Math.hypot(dx,dy);
    minGap=Math.min(minGap,distance);if(distance<7.9)crowded.push({a:a.name,b:b.name,distance});
  }
  return {count:targets.length,minWidth:Math.min(...targets.map(t=>t.width)),minHeight:Math.min(...targets.map(t=>t.height)),minGap,undersized,crowded};
});
async function assertTouchGeometry(context){const geometry=await touchGeometry();assert.deepEqual(geometry.undersized,[],context+' touch size');assert.deepEqual(geometry.crowded,[],context+' touch spacing');return geometry;}
try{
  for(const route of ['/design-study',...ids.map(id=>'/design-study/'+(id==='a1'?'a1-synthetic':id))])assert.equal((await fetch(origin+route,{headers:{Origin:'https://chat.example','Sec-Fetch-Site':'cross-site'}})).status,200,route);
  await p.goto(origin+'/design-study');await p.evaluate(()=>document.fonts.ready);assert.equal(await p.locator('.study').count(),ids.length);assert.equal(await p.locator('.study#a3').count(),0);
  for(const group of ['frontend','pro','baseline'])await p.locator('#'+group).screenshot({path:'reports/design-study-'+group+'.png'});
  for(const id of ids)for(const width of [320,390,768,1024]){
    await p.setViewportSize({width,height:844});await p.goto(origin+'/design-study/'+(id==='a1'?'a1-synthetic':id));await p.evaluate(()=>document.fonts.ready);
    const text=await p.locator('.mock').innerText();for(const value of ['Алиса','Даня','ТестСироп','ТестСпрей','ТестТаблетки','ТестРаствор','2,5 мл','37,4 °C','4 капли',...(id==='a1'?['1 пшик','2 пшика','Второй ужин','Через 10–15 мин после ТестСпрей']:['19:00','21:30','1 впрыскивание'])])assert.ok(text.includes(value),id+' missing '+value);
    const result=await inspect();assert.equal(result.overflow,false,id+' overflow '+width);assert.deepEqual(result.clipped,[],id+' clipped '+width);assert.ok(result.firstDrug<420,id+' drug below fold');assert.ok(result.fontLoaded);results.push({id,width,...result});
    if(width===390||id==='b3'&&width===768)await p.screenshot({path:'reports/design-study-'+id+'-'+width+'.png',fullPage:true});
    if(width===390){await p.getByRole('link',{name:'Следующий',exact:true}).click();assert.ok(p.url().endsWith(ids[(ids.indexOf(id)+1)%ids.length]==='a1'?'a1-synthetic':ids[(ids.indexOf(id)+1)%ids.length]));}
  }
  // A1 uses the same component in the gallery, on a phone, and on an iPad.
  for(const [width,height]of [[320,844],[390,844],[768,1024],[820,1180],[1024,768],[1180,820]]){
    await p.setViewportSize({width,height});await p.goto(origin+'/design-study/a1-synthetic');await p.evaluate(()=>document.fonts.ready);
    assert.equal(await p.locator('.care-current .care-med').count(),5);assert.equal(await p.locator('.care-med-later').count(),2);
    assert.equal(await p.locator('.care-current .care-instruction:visible').count(),0);
    assert.doesNotMatch(await p.locator('.mock').innerText(),/Сегодня|9 ноября|19:00|21:30|в каждую ноздрю|впрыскивание/);
    assert.equal(await p.locator('.care-people time').count(),0);assert.equal(await p.locator('.care-history time').count(),2);
    const positions=await p.locator('.care-person').evaluateAll(nodes=>nodes.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,color:getComputedStyle(e).backgroundColor})));
    assert.notEqual(positions[0].color,positions[1].color);assert.equal(positions[0].y===positions[1].y,width>=700);
    const touch=await assertTouchGeometry('A1 '+width);
    assert.equal(await p.locator('.care-take input:checked').count(),0);
    assert.equal((await inspect()).overflow,false);await p.screenshot({path:`reports/a1-v2-${width}.png`,fullPage:true});
    const row=p.locator('.care-person.alice .care-med').first(),summary=row.locator('summary'),mark=row.locator('.care-take'),checkbox=row.getByRole('checkbox');
    await mark.tap();assert.equal(await checkbox.isChecked(),true);assert.equal(await row.locator('details[open]').count(),0);
    if(width>=700)assert.equal(await p.locator('.care-person').evaluateAll(xs=>xs[0].getBoundingClientRect().y===xs[1].getBoundingClientRect().y),true,'mark must not change tablet columns');
    await mark.tap();assert.equal(await checkbox.isChecked(),false);
    await mark.tap({position:{x:2,y:24}});assert.equal(await checkbox.isChecked(),true);assert.equal(await row.locator('details[open]').count(),0);assert.equal(await p.locator('.care-person.alice .care-med').nth(1).getByRole('checkbox').isChecked(),false);
    const summaryBox=await summary.boundingBox();await summary.tap({position:{x:summaryBox.width-2,y:24}});assert.equal(await row.locator('details[open]').count(),1);assert.equal(await checkbox.isChecked(),true);await assertTouchGeometry('A1 open '+width);
    await summary.tap();await mark.tap({position:{x:46,y:24}});assert.equal(await checkbox.isChecked(),false);assert.equal(await row.locator('details[open]').count(),0);
    await p.locator('.care-person.alice summary').nth(1).click();assert.match(await p.locator('.care-person.alice details[open]').innerText(),/1 впрыскиванию в каждую ноздрю/);
    assert.equal((await inspect()).overflow,false);await p.locator('.care-person.alice summary').nth(1).click();
    await p.locator('.care-family label').filter({hasText:'Даня'}).click();assert.equal(await p.locator('.care-person:visible').count(),1);assert.equal(await p.locator('.care-event:visible').count(),1);assert.equal(await p.locator('.care-person.danya').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');await assertTouchGeometry('A1 single person '+width);
    await p.locator('.care-family label').filter({hasText:'Мама'}).click();assert.equal(await p.locator('.care-person:visible').count(),0);assert.match(await p.locator('.care-empty:visible').innerText(),/^Мама\s+Назначений нет$/);
    await p.locator('.care-family label').filter({hasText:'Папа'}).click();assert.match(await p.locator('.care-empty:visible').innerText(),/^Папа\s+Назначений нет$/);
    await p.locator('.care-family label').filter({hasText:'Алиса'}).click();assert.equal(await p.locator('.care-person.alice:visible').count(),1);assert.equal(await p.locator('.care-event:visible').count(),1);
    await p.locator('.care-family label').filter({hasText:'Все'}).click();assert.equal(await p.locator('.care-person:visible').count(),2);
    await assertTouchGeometry('A1 returned to all '+width);
    results.push({a1Revision:2,width,height,columns:width>=700?2:1,details:true,filters:true,slotNamesOnly:true,touch,touchCenterAndEdges:true});
  }
  for(const width of [320,390,768,1024,1360]){
    await p.setViewportSize({width,height:1024});await p.goto(origin+'/design-study');await p.evaluate(()=>document.fonts.ready);const result=await inspect();assert.equal(result.overflow,false,'gallery '+width);assert.deepEqual(result.clipped,[],'gallery clipped '+width);results.push({gallery:true,width,...result});
    await assertTouchGeometry('gallery A1 '+width);
    if(width===768)await p.screenshot({path:'reports/design-study-gallery-768.png',fullPage:true});
  }
  await p.getByRole('link',{name:'Открыть',exact:true}).first().click();await p.getByRole('link',{name:'Все варианты',exact:true}).click();assert.equal(await p.locator('.study').count(),ids.length);
  assert.equal(requests.filter(u=>new URL(u).pathname.startsWith('/api/')).length,0);assert.deepEqual(errors,[]);
  await writeFile('reports/design-study-check.json',JSON.stringify({status:'PASS',completedAt:new Date().toISOString(),a1Revision:2,activeDesigns:ids.length,syntheticOnly:true,physicalIPadTested:false,clinicalApiRequests:0,results,errors},null,2));console.log('PASS: 8 light designs × 4 widths; A1 v2 phone / iPad × 6 sizes, details, family filters, slots, no API requests.');
}finally{await b.close();}
