import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {createApp} from '../server.mjs';

test('Внешняя ссылка открывает оболочку; чужие Origin/fetch-site не получают API и не пишут данные',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'medika-navigation-')),port=14392,app=await createApp({dataDir:dir,port});
  await new Promise(r=>app.server.listen(port,'127.0.0.1',r));const origin=`http://127.0.0.1:${port}`;
  const call=(path,headers={},method='GET')=>new Promise((resolve,reject)=>{const req=request(origin+path,{method,headers},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end(method==='POST'?JSON.stringify({name:'Не должно сохраниться'}):undefined);});
  try{
    const token=JSON.parse((await call('/api/session')).body).token;
    const navigation={'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
    for(const headers of [navigation,{...navigation,Origin:'https://chat.example'},{'Sec-Fetch-Site':'cross-site'}]){
      const page=await call('/',headers);assert.equal(page.status,200);assert.match(page.body,/<html/);assert.doesNotMatch(page.body,/medika_session|"people"/);
    }
    assert.equal((await call('/',navigation,'HEAD')).status,200);
    for(const path of ['/api/session','/api/state','/api/backup','/api/documents/00000000-0000-0000-0000-000000000000/image']){
      assert.equal((await call(path,{...navigation,'X-Medika-Token':token})).status,403);
      assert.equal((await call(path,{Origin:'https://chat.example','X-Medika-Token':token})).status,403);
    }
    for(const headers of [navigation,{Origin:'https://chat.example'}])assert.equal((await call('/api/people',{...headers,'X-Medika-Token':token,'Content-Type':'application/json'},'POST')).status,403);
    assert.equal((await call('/',navigation,'POST')).status,403);
    assert.deepEqual(JSON.parse((await call('/api/state',{'X-Medika-Token':token})).body).people,[]);
  }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
