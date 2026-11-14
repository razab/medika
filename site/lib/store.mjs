import {assertContract,recordContracts} from './pilot-contracts.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { newId, assert } from './domain.mjs';

export function openStore(directory) {
  mkdirSync(directory, {recursive:true, mode:0o700});
  chmodSync(directory, 0o700);
  const file=join(directory,'medika.sqlite'), db=new DatabaseSync(file);
  chmodSync(file,0o600);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES people(id),hash TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(person_id,hash));
    CREATE TABLE IF NOT EXISTS prescriptions(id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES people(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,rx_id TEXT NOT NULL REFERENCES prescriptions(id),event_key TEXT UNIQUE NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS temperatures(id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES people(id),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES people(id),client_key TEXT UNIQUE NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS medicines(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS medicinePhotos(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,data TEXT NOT NULL);`);
  function rows(table) { return db.prepare(`SELECT data FROM ${table}`).all().map(r=>JSON.parse(r.data)); }
  function state() { return {version:1,people:rows('people'),documents:rows('documents'),prescriptions:rows('prescriptions'),events:rows('events'),temperatures:rows('temperatures'),activities:rows('activities'),medicinePhotos:rows('medicinePhotos'),medicines:rows('medicines')}; }
  function get(table,id) { const row=db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id); return row?JSON.parse(row.data):null; }
  function audit(action,record) { const id=newId(),createdAt=new Date().toISOString();db.prepare('INSERT INTO audit VALUES(?,?,?)').run(id,createdAt,JSON.stringify({id,createdAt,action,record})); }
  function validateRecord(table,record,old=null){
    if(!recordContracts[table])return;
    assertContract(recordContracts[table],JSON.parse(JSON.stringify(record)));
    if(old)for(const field of table==='events'?['rxId','personId','key']:table==='prescriptions'?['personId']:[])assert(old[field]===record[field],'Нельзя изменить связь существующей записи: '+field,409);
    if(table==='prescriptions'){
      assert(get('people',record.personId),'Человек не найден');
      if(record.medicineId)assert(get('medicines',record.medicineId),'Лекарство не найдено');
    }
    if(table==='events'){const rx=get('prescriptions',record.rxId);assert(rx&&rx.personId===record.personId,'Факт относится к другому человеку или отсутствующему назначению');}
  }
  let inTransaction=false;
  function transaction(fn) { if(inTransaction)return fn();db.exec('BEGIN IMMEDIATE');inTransaction=true;try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}finally{inTransaction=false;} }
  function insert(table,data) {
    const record={...data,id:data.id||newId(),version:1,createdAt:new Date().toISOString()};
    return transaction(()=>{
      validateRecord(table,record);
      const columns=table==='documents'?['person_id','hash']:table==='activities'?['person_id','client_key']:['prescriptions','temperatures'].includes(table)?['person_id']:table==='events'?['rx_id','event_key']:[];
      const extra=table==='documents'?[record.personId,record.hash]:table==='activities'?[record.personId,record.clientKey]:['prescriptions','temperatures'].includes(table)?[record.personId]:table==='events'?[record.rxId,record.key]:[];
      db.prepare(`INSERT INTO ${table}(id,data${columns.map(c=>','+c).join('')}) VALUES(${['?','?',...extra.map(()=>'?')].join(',')})`).run(record.id,JSON.stringify(record),...extra);
      audit('create:'+table,record);return record;
    });
  }
  function update(table,id,input,version) {
    return transaction(()=>{
      const old=get(table,id);assert(old,'Запись не найдена',404);assert(old.version===version,'Запись уже изменена. Обновите страницу.',409);
      const record={...old,...input,id:old.id,version:old.version+1,updatedAt:new Date().toISOString()};
      validateRecord(table,record,old);
      db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(JSON.stringify(record),id);audit('update:'+table,{before:old,after:record});return record;
    });
  }
  return {db,state,get,insert,update,transaction,history:()=>rows('audit'),close:()=>db.close()};
}
