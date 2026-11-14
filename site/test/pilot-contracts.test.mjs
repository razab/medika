import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {contractErrors,pilotSchemas,pilotContractDocument,assertEventTransition,transitions} from '../lib/pilot-contracts.mjs';
import {openStore} from '../lib/store.mjs';
import {medicineInput} from '../lib/medicines.mjs';
import {rxInput} from '../lib/domain.mjs';

const date='2026-11-14',base={name:'Тест',dose:'1',unit:'мл',type:'routine',routineSlots:[{anchor:'clock',time:'19:00'}],startDate:date,confirmed:true};
test('Executable pilot schema: exact wire/normalized types, defaults without mutation, clock and readonly shape',()=>{
 const wire={personId:'p',...base},copy=structuredClone(wire);assert.deepEqual(contractErrors('PrescriptionCreate',wire),[]);assert.deepEqual(wire,copy);
 assert.equal(contractErrors('PrescriptionCreate',{...wire,requiresReview:true,review:'Синтетическая legacy-аннотация'}).length,0);
 assert.equal(contractErrors('PrescriptionCreate',{...wire,routineSlots:[{anchor:'breakfast',time:''}]}).length,0);assert.deepEqual(rxInput({...base,routineSlots:[{anchor:'breakfast',time:''}]}).routineSlots,[{anchor:'breakfast',relation:''}]);
 const normalized=rxInput(base);assert.equal(normalized.timeZone,'Europe/Chisinau');assert.equal(normalized.dose,'1');assert.equal(normalized.intervalHours,null);assert.deepEqual(contractErrors('PrescriptionInput',normalized),[]);
 assert(contractErrors('PrescriptionInput',{...normalized,dose:1}).length);assert(contractErrors('PrescriptionCreate',{...wire,dose:{value:1}}).length);assert(contractErrors('PrescriptionCreate',{...wire,dose:'-1'}).length);assert(contractErrors('PrescriptionCreate',{...wire,createdAt:'forged'}).length);
 for(const value of [{anchor:'clock'},{anchor:'clock',time:'25:00'},{anchor:'clock',time:'19:00',relation:'before'},{anchor:'dinner',unexpected:true}])assert(contractErrors('Slot',value).length);
 assert.equal(contractErrors('Slot',{anchor:'clock',time:'19:00',relation:''}).length,0);
 assert.equal(contractErrors('StoredSlot',{anchor:'breakfast',relation:'',offsetMinutes:15}).length,0);assert(contractErrors('Slot',{anchor:'breakfast',offsetMinutes:15}).length);
 assert(contractErrors('EventCreate',{rxId:'rx',status:'taken',occurredAt:null}).length);assert.equal(contractErrors('EventCreate',{rxId:'rx',status:'taken',occurredAt:null,timeUnknown:true,knownDate:date}).length,0);
 const m=medicineInput({name:'Тест',medicineForm:'liquid'});assert.deepEqual([m.archived,m.strength,m.instructions],[false,'','']);assert(contractErrors('MedicineInput',{...m,archived:'false'}).length);
});
test('Every published transition is enforced by the same server guard; forbidden transitions fail',()=>{
 for(const edge of transitions.event.rows)assert.doesNotThrow(()=>assertEventTransition(edge.from,edge.command,edge.to));
 for(const [from,command,to] of [['taken','event.create','taken'],['absent','event.void','void'],['void','event.create','planned'],['taken','delete','absent']])assert.throws(()=>assertEventTransition(from,command,to),e=>e.code==='INVALID_INPUT');
});
test('SQLite write boundary validates before commit/audit; physical keys agree with contract',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'contract-sql-')),store=openStore(dir);
 try{
  const p=store.insert('people',{name:'Тестовый человек'}),m=store.insert('medicines',medicineInput({name:'Тест',medicineForm:'liquid'})),r=store.insert('prescriptions',{...rxInput(base),personId:p.id,medicineId:m.id,archived:false});
  const before=store.state(),audit=store.history();assert.throws(()=>store.update('prescriptions',r.id,{dose:false},r.version));assert.throws(()=>store.insert('medicines',{name:'Ошибка',medicineForm:'wrong'}));assert.throws(()=>store.update('prescriptions',r.id,{personId:'other'},r.version));assert.deepEqual(store.state(),before);assert.deepEqual(store.history(),audit);
  for(const entity of pilotContractDocument().entities){const columns=store.db.prepare('PRAGMA table_info('+entity.storage.table+')').all();assert(columns.some(c=>c.name==='id'&&c.pk));assert(columns.some(c=>c.name===entity.storage.column));}
  assert(store.db.prepare('PRAGMA foreign_key_list(events)').all().some(f=>f.from==='rx_id'&&f.table==='prescriptions'));
  assert(store.db.prepare('PRAGMA foreign_key_list(prescriptions)').all().some(f=>f.from==='person_id'&&f.table==='people'));
  assert(store.db.prepare('PRAGMA index_list(events)').all().some(i=>i.unique));
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('Contract graph covers all pilot data tags, components and operations with real schema paths',async()=>{
 const doc=pilotContractDocument(),atlas=JSON.parse(await readFile(new URL('../public/ui-atlas/manifest.json',import.meta.url),'utf8')),seed=JSON.parse(await readFile(new URL('../public/ui-atlas/flows-seed.json',import.meta.url),'utf8'));
 assert.deepEqual(new Set(doc.entities.map(v=>v.id)),new Set(seed.entities.map(v=>v.id)));
 for(const operation of doc.operations){assert(pilotSchemas.definitions[operation.response]);assert(pilotSchemas.definitions[operation.error]);if(operation.request)assert(pilotSchemas.definitions[operation.request]);for(const id of operation.actionIds)assert(atlas.actions.some(a=>a.id===id));}
 for(const b of doc.bindings){assert(atlas.components.some(c=>c.id===b.component));assert(pilotSchemas.definitions[b.type]);for(const path of b.paths)assert(pilotSchemas.definitions[b.type].properties[path],b.type+'.'+path);for(const id of [b.read,b.write,b.undo].filter(Boolean))assert(doc.operations.some(o=>o.id===id));}
});

test('HTTP transition matrix: record each allowed status, void, repeat with version, restore, reject occupied key',async()=>{
 const {createApp}=await import('../server.mjs'),dir=await mkdtemp(join(tmpdir(),'contract-transitions-')),port=14431,app=await createApp({dataDir:dir,port}),origin='http://127.0.0.1:'+port;await new Promise(r=>app.server.listen(port,'127.0.0.1',r));
 const {token}=await(await fetch(origin+'/api/session')).json();const call=async(path,data,status=200)=>{const response=await fetch(origin+'/api'+path,{method:data?'POST':'GET',headers:{'X-Medika-Token':token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;};
 try{
  const p=await call('/people',{name:'Синтетический пациент'},201),today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Chisinau'}),r=await call('/prescriptions',{...base,personId:p.id,startDate:today,routineSlots:[{anchor:'breakfast'},{anchor:'lunch'},{anchor:'dinner'}]},201),schedule=await call('/schedule?date='+today);
  for(const [i,status] of ['taken','skipped','deferred'].entries()){
   const body={rxId:r.id,rxVersion:r.version,key:schedule.items[i].key,date:today,status,dose:'1'};let event=await call('/events',body,201);assert.equal(event.status,status);
   const before=app.store.history().length;await call('/events',body,409);assert.equal(app.store.history().length,before);
   for(const target of ['taken','skipped','deferred']){
    event=await call('/events/'+event.id+'/void',{version:event.version,reason:'Тест матрицы переходов'});assert.equal(event.status,'void');
    event=await call('/events/'+event.id+'/void',{version:event.version,reason:'Повтор с новой версией разрешён'});assert.equal(event.status,'void');const id=event.id;
    event=await call('/events',{...body,status:target},200);assert.equal(event.id,id);assert.equal(event.status,target);
   }
  }
  const before=app.store.state(),audit=app.store.history();const invalid=await call('/events',{rxId:r.id,status:'planned'},400);assert.equal(invalid.code,'INVALID_INPUT');assert(invalid.fields.some(f=>f.path==='/status'));await call('/events',{rxId:r.id,rxVersion:0,key:schedule.items[0].key,date:today,status:'taken'},409);assert.deepEqual(app.store.state(),before);assert.deepEqual(app.store.history(),audit);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
