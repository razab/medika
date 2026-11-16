import {DatabaseSync,backup} from 'node:sqlite';
import {cp,lstat,mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const folders=['uploads','prescription-lab','voice-lab','medicine-recognition','design-study','imports'];
const tables=['people','documents','prescriptions','events','temperatures','activities','medicines','medicinePhotos','audit'];
const database=directory=>join(directory,'medika.sqlite');

async function verify(directory){
  const db=new DatabaseSync(database(directory),{readOnly:true});
  try{
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    for(const {data} of db.prepare('SELECT data FROM documents').iterate()){
      const doc=JSON.parse(data);
      if(!doc.mime)continue;
      assert.match(doc.id,/^[a-f0-9-]{36}$/);
      const original=await readFile(join(directory,'uploads',doc.id));
      assert.equal(createHash('sha256').update(original).digest('hex'),doc.hash,'Отпечаток оригинала выписки');
    }
    return Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT count(*) AS size FROM ${table}`).get().size]));
  }finally{db.close();}
}

process.umask(0o077);
const [source,destination]=process.argv.slice(2);
if(!source)throw Error('Usage: node snapshot.mjs SOURCE [DESTINATION]');
if(destination){
  await mkdir(destination,{mode:0o700});
  const db=new DatabaseSync(database(source),{readOnly:true});
  try{await backup(db,database(destination));}finally{db.close();}
  for(const folder of folders){
    const original=join(source,folder);
    try{assert((await lstat(original)).isDirectory());}catch(error){if(error.code==='ENOENT')continue;throw error;}
    await cp(original,join(destination,folder),{recursive:true,filter:async path=>{
      const entry=await lstat(path);
      return entry.isFile()||entry.isDirectory();
    }});
  }
}
console.log(JSON.stringify(await verify(destination||source)));
