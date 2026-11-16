import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createApp} from '../server.mjs';
import {openAuth} from '../lib/auth.mjs';

test('Google OAuth: приглашение, вход, привязка с повторным паролем и отклонение поддельного callback',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'medika-google-'));
  const host='medika.example.test',origin='https://'+host,clientId='test.apps.googleusercontent.com',clientSecret='test-secret';
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const key={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
  const payload=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const codes=new Map();
  const googleOptions={clientId,clientSecret,async fetchGoogle(url,options){
    assert.equal(options.redirect,'error');
    if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[key]});
    assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.equal(options.body.get('client_secret'),clientSecret);
    assert.equal(options.body.get('redirect_uri'),origin+'/auth/google/callback');
    const {nonce,subject,challenge,invalid}=codes.get(options.body.get('code'));
    assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'),challenge);
    const now=Math.floor(Date.now()/1000);
    const body=payload({iss:'https://accounts.google.com',aud:invalid==='aud'?'another-client':clientId,
      exp:now+120,iat:now,sub:subject,nonce:invalid==='nonce'?'other-nonce':nonce});
    const signed=payload({alg:'RS256',kid:'test-key'})+'.'+body;
    const signature=invalid==='signature'?'forged':sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
    return Response.json({id_token:signed+'.'+signature,access_token:'test-discarded-token'});
  }};
  let app;
  async function run(){
    app=await createApp({dataDir,publicHost:host,requireAccount:true,googleOptions});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  }
  function request(path,{body,headers={},ip='192.0.2.3'}={}){
    return new Promise((resolve,reject)=>{
      const req=http.request({
        host:'127.0.0.1',port:app.server.address().port,path,method:body?'POST':'GET',
        headers:{Host:host,'X-Forwarded-Proto':'https','X-Medika-Client-IP':ip,...(body?{Origin:origin,'Content-Type':'application/json'}:{}),...headers}
      },res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
        res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,json:()=>JSON.parse(Buffer.concat(chunks))}));
      });
      req.on('error',reject);
      req.end(body?JSON.stringify(body):undefined);
    });
  }
  async function start(body,headers={}){
    const response=await request('/auth/google/start',{body,headers});
    assert.equal(response.status,200,JSON.stringify(response.json()));
    const params=new URL(response.json().location).searchParams;
    assert.equal(params.get('scope'),'openid');
    assert.equal(params.get('code_challenge_method'),'S256');
    assert.equal(params.get('redirect_uri'),origin+'/auth/google/callback');
    assert.match(response.headers['set-cookie'][0],/Secure; HttpOnly; SameSite=Lax/);
    return {cookie:response.headers['set-cookie'][0].split(';')[0],params};
  }
  async function callback(flow,subject,{invalid,session='',state=flow.params.get('state')}={}){
    const code='test-code-'+codes.size;
    codes.set(code,{nonce:flow.params.get('nonce'),challenge:flow.params.get('code_challenge'),subject,invalid});
    return request('/auth/google/callback?'+new URLSearchParams({code,state}),{headers:{Cookie:[flow.cookie,session].filter(Boolean).join('; '),'Sec-Fetch-Site':'cross-site'}});
  }
  const sessionCookie=response=>response.headers['set-cookie']?.find(value=>value.startsWith('__Host-medika='))?.split(';')[0];
  try{
    await run();
    assert.deepEqual((await request('/api/account/providers')).json(),{google:true,linked:false});
    assert.equal((await request('/auth/google/start',{body:{mode:'register',username:'someone',invite:'f'.repeat(64)}})).status,403);
    assert.equal((await request('/auth/google/start',{body:{mode:'login'},headers:{Origin:'https://other.example.test'}})).status,403);
    const unlinked=await start({mode:'login'});
    assert.equal((await callback(unlinked,'unknown-google')).headers.location,'/login?google=unlinked');
    assert.equal((await request('/api/family')).status,401);
    const invite=openAuth(app.store.db).invite();
    const registration=await start({mode:'register',username:'google-user',invite});
    assert.equal((await callback(registration,'google-sub',{state:'z'.repeat(43)})).headers.location,'/login?google=invalid');
    await app.close();app=null;await run();
    const registered=await callback(registration,'google-sub');
    assert.equal(registered.headers.location,'/family');
    const cookie=sessionCookie(registered);
    assert.equal((await request('/api/session',{headers:{Cookie:cookie}})).json().username,'google-user');
    assert.equal((await callback(registration,'google-sub')).headers.location,'/login?google=invalid');
    assert.equal((await request('/auth/google/start',{body:{mode:'register',username:'someone',invite}})).status,403);
    assert.equal((await request('/api/account/login',{body:{username:'google-user',password:'some password'}})).status,401);
    for(const invalid of ['aud','nonce','signature']){
      const forged=await start({mode:'login'});
      assert.equal((await callback(forged,'google-sub',{invalid})).headers.location,'/login?google=invalid');
    }
    const signedIn=await callback(await start({mode:'login'}),'google-sub');
    assert.ok(sessionCookie(signedIn));
    const password='local synthetic password';
    const local=await request('/api/account/register',{body:{username:'local-user',password,invite:openAuth(app.store.db).invite()},ip:'192.0.2.4'});
    const localCookie=sessionCookie(local),localSession=(await request('/api/session',{headers:{Cookie:localCookie}})).json();
    const headers={Cookie:localCookie,'X-Medika-Token':localSession.token,'X-Medika-Client-IP':'192.0.2.5'};
    assert.equal((await request('/auth/google/start',{body:{mode:'link',password},headers:{Cookie:localCookie}})).status,403);
    assert.equal((await request('/auth/google/start',{body:{mode:'link',password:'wrong password'},headers})).status,401);
    const stolen=await start({mode:'link',password},headers);
    assert.equal((await callback(stolen,'other-google')).headers.location,'/account?google=invalid');
    const occupied=await start({mode:'link',password},headers);
    assert.equal((await callback(occupied,'google-sub',{session:localCookie})).headers.location,'/account?google=conflict');
    const linked=await callback(await start({mode:'link',password},headers),'local-google',{session:localCookie});
    assert.equal(linked.headers.location,'/account');
    assert.equal((await request('/api/session',{headers:{Cookie:localCookie}})).status,401);
    const linkedSession=sessionCookie(linked);
    assert.deepEqual((await request('/api/account/providers',{headers:{Cookie:linkedSession}})).json(),{google:true,linked:true});
    assert.equal((await request('/api/session',{headers:{Cookie:sessionCookie(await callback(await start({mode:'login'}, {'X-Medika-Client-IP':'192.0.2.6'}),'local-google'))}})).json().username,'local-user');
  }finally{
    await app?.close();
    await rm(dataDir,{recursive:true,force:true});
  }
});
