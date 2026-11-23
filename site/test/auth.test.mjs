import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createApp} from '../server.mjs';
import {openAuth} from '../lib/auth.mjs';

test('Публичная Медика: регистрация по приглашению, защита журнала и вложений, отзыв сессий',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'medika-auth-'));
  const host='medika.example.test', origin='https://'+host;
  let app=await createApp({dataDir,publicHost:host,requireAccount:true});
  let base;
  async function start(){
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    base='http://127.0.0.1:'+app.server.address().port;
  }
  function request(path,{body,headers={},method=body?'POST':'GET'}={}){
    const form=body instanceof URLSearchParams;
    return new Promise((resolve,reject)=>{
      const req=http.request(base+path,{
        method,headers:{Host:host,'X-Forwarded-Proto':'https','X-Medika-Client-IP':'192.0.2.1',...(body?{Origin:origin,'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{}),...headers}
      },res=>{
        const chunks=[];
        res.on('data',chunk=>chunks.push(chunk));
        res.on('error',reject);
        res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
      });
      req.on('error',reject);
      req.end(form?body.toString():body?JSON.stringify(body):undefined);
    });
  }
  try{
    await start();
    assert.equal((await request('/api/health',{headers:{'X-Forwarded-Proto':'http'}})).status,403);
    assert.equal((await request('/api/health',{headers:{Host:'localhost:4382'}})).status,403);
    const landing=await request('/family');
    assert.equal(landing.status,303);
    assert.equal(landing.headers.get('location'),'/login');
    const loginPage=await request('/login'),registerPage=await request('/register');
    assert.equal(loginPage.status,200);
    assert.equal(loginPage.headers.get('referrer-policy'),'same-origin');
    assert.equal(registerPage.status,200);
    const loginHTML=await loginPage.text(),registerHTML=await registerPage.text();
    assert.match(loginHTML,/<form[^>]*method="post"[^>]*action="\/login"/);
    assert.match(loginHTML,/Электронная почта<input[^>]*name="email"[^>]*type="email"[^>]*autocomplete="username"/);
    assert.match(loginHTML,/<input[^>]*type="password"[^>]*autocomplete="current-password"/);
    assert.equal((loginHTML.match(/type="password"/g)||[]).length,1);
    assert.doesNotMatch(loginHTML,/google-link-form/);
    assert.match(registerHTML,/<form[^>]*method="post"[^>]*action="\/register"/);
    assert.match(registerHTML,/Электронная почта<input[^>]*name="email"[^>]*type="email"[^>]*autocomplete="username"/);
    assert.match(registerHTML,/<input[^>]*type="password"[^>]*autocomplete="new-password"/);
    assert.doesNotMatch(registerHTML,/autocomplete="current-password"/);
    for(const path of ['/api/session','/api/state','/api/family','/api/backup','/api/audit','/api/design-study/a1-snapshot','/api/documents/abc/image']){
      assert.equal((await request(path,{headers:{'X-Medika-Token':'a'.repeat(64)}})).status,401,path);
    }
    const invite=openAuth(app.store.db).invite(),password='synthetic-long-password 42';
    const email='test-family+medika@long-domain.example.test';
    const credentials={email:` ${email.toUpperCase()} `,password,invite};
    assert.equal((await request('/api/account/register',{body:credentials,headers:{Origin:'https://other.example.test'}})).status,403);
    assert.equal((await request('/api/account/register',{body:{...credentials,password:'short'}})).status,400);
    for(const invalid of ['test-family','bad..address@example.test','bad@example-.test']){
      const response=await request('/api/account/register',{body:{...credentials,email:invalid}});
      assert.equal(response.status,400);
      assert.match((await response.json()).error,/корректный email/);
    }
    assert.equal((await request('/api/account/register',{body:{...credentials,invite:'a'.repeat(64)}})).status,403);
    const registration=await request('/api/account/register',{body:credentials});
    assert.equal(registration.status,201);
    const setCookie=registration.headers.get('set-cookie'),cookie=setCookie.split(';')[0];
    assert.match(setCookie,/^__Host-medika=[a-f0-9]{64}; Secure; HttpOnly; SameSite=Lax; Path=\//);
    assert.equal((await request('/api/account/register',{body:{...credentials,email:'another-user@example.test'}})).status,403);
    assert.equal((await request('/api/account/login',{body:{email,password:'wrong input'}})).status,401);
    const form=new URLSearchParams({email,password});
    assert.equal((await request('/login',{body:form,headers:{Origin:'https://other.example.test'}})).status,403);
    assert.equal((await request('/login',{body:form,headers:{Origin:'null'}})).status,403);
    const rejected=await request('/login',{body:new URLSearchParams({email,password:'<synthetic wrong password>'})});
    assert.equal(rejected.status,401);
    assert.equal(rejected.headers.get('set-cookie'),null);
    const rejectedHTML=await rejected.text();
    assert.match(rejectedHTML,/role="alert">Проверьте email и пароль/);
    assert.doesNotMatch(rejectedHTML,/synthetic wrong password/);
    const alternate=await request('/login2');
    assert.equal(alternate.status,200);
    assert.equal(alternate.headers.get('referrer-policy'),'same-origin');
    const alternateHTML=await alternate.text();
    assert.match(alternateHTML,/<form method="post" action="\/login2" novalidate>/);
    assert.match(alternateHTML,/<input[^>]*type="email"[^>]*autocomplete="username"/);
    assert.match(alternateHTML,/<input[^>]*type="password"[^>]*autocomplete="current-password"/);
    assert.doesNotMatch(alternateHTML,/\brequired\b|<script\b/);
    const emptyAlternate=await request('/login2',{body:new URLSearchParams({email:'',password:''})});
    assert.equal(emptyAlternate.status,400);
    assert.equal(emptyAlternate.headers.get('set-cookie'),null);
    assert.match(await emptyAlternate.text(),/role="alert">Проверьте email и пароль/);
    assert.equal((await request('/login2',{body:form,headers:{Origin:'https://other.example.test'}})).status,403);
    const alternateLogin=await request('/login2',{body:form});
    assert.equal(alternateLogin.status,303);
    assert.equal(alternateLogin.headers.get('location'),'/family');
    assert.match(alternateLogin.headers.get('set-cookie'),/^__Host-medika=/);
    const native=await request('/login',{body:form});
    assert.equal(native.status,303);
    assert.equal(native.headers.get('location'),'/family');
    const nativeCookie=native.headers.get('set-cookie');
    assert.match(nativeCookie,/^__Host-medika=[a-f0-9]{64}; Secure; HttpOnly; SameSite=Lax; Path=\//);
    const signedIn=await request('/account',{headers:{Cookie:nativeCookie.split(';')[0]}});
    assert.equal(signedIn.status,200);
    const accountHTML=await signedIn.text();
    assert.match(accountHTML,/id="google-link-form"/);
    assert.doesNotMatch(accountHTML,/id="current-password"/);

    const authHeaders=await (async()=>{
      const response=await request('/api/session',{headers:{Cookie:cookie}});
      assert.equal(response.status,200);
      const {token,username}=await response.json();
      assert.equal(username,email);
      return {Cookie:cookie,'X-Medika-Token':token};
    })();
    const codePage=await request('/login/code');
    assert.equal(codePage.status,200);
    assert.equal(codePage.headers.get('referrer-policy'),'same-origin');
    assert.match(await codePage.text(),/<form[^>]*method="post"[^>]*action="\/login\/code"/);
    const issueCode=(headers=authHeaders)=>request('/api/account/login-code',{method:'POST',headers:{Origin:origin,...headers}});
    assert.equal((await issueCode({})).status,403);
    assert.equal((await issueCode({Cookie:cookie})).status,403);
    assert.equal((await issueCode({...authHeaders,Origin:'https://other.example.test'})).status,403);
    const readCode=async()=>{
      const response=await issueCode();
      assert.equal(response.status,201);
      assert.equal(response.headers.get('cache-control'),'no-store');
      const {code}=await response.json();
      const stored=app.store.db.prepare('SELECT secret_hash FROM auth_login_codes WHERE username=?').get(email);
      assert.match(code,/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      assert.match(stored.secret_hash,/^[a-f0-9]{64}$/);
      return code;
    };
    const redeemCode=(code,headers={})=>request('/login/code',{body:new URLSearchParams({code}),headers});
    const superseded=await readCode(),active=await readCode();
    const rejectedCode=await redeemCode(superseded);
    assert.equal(rejectedCode.status,401);
    assert.doesNotMatch(await rejectedCode.text(),new RegExp(superseded));
    assert.equal((await redeemCode(active,{Origin:'https://other.example.test'})).status,403);
    const simultaneous=await Promise.all([redeemCode(active),redeemCode(active.replaceAll('-','').toLowerCase())]);
    assert.deepEqual(simultaneous.map(r=>r.status).sort(),[303,401]);
    const acceptedCode=simultaneous.find(r=>r.status===303);
    assert.equal(acceptedCode.headers.get('location'),'/family');
    const newSession=await request('/api/session',{headers:{Cookie:acceptedCode.headers.get('set-cookie').split(';')[0]}});
    assert.equal((await newSession.json()).username,email);
    const expiredCode=await readCode();
    app.store.db.prepare('UPDATE auth_login_codes SET expires_at=0 WHERE username=?').run(email);
    assert.equal((await redeemCode(expiredCode)).status,401);
    const restartCode=await readCode();
    assert.equal((await request('/api/family',{headers:{Cookie:cookie}})).status,403);
    assert.equal((await request('/api/family',{headers:{'X-Medika-Token':authHeaders['X-Medika-Token']}})).status,401);
    assert.equal((await request('/api/people',{body:{name:'Тест'},headers:{...authHeaders,Origin:'https://other.example.test'}})).status,403);
    assert.equal((await request('/api/people',{body:{name:'Тест'},headers:{Cookie:cookie}})).status,403);
    assert.equal((await request('/api/people',{body:{name:''},headers:authHeaders})).status,400);
    const added=await request('/api/people',{body:{name:'Тестовая семья'},headers:authHeaders});
    assert.equal(added.status,201);
    const {id}=await added.json();
    const family=await request('/api/family',{headers:authHeaders});
    assert.equal(family.status,200);
    assert.equal((await family.json()).model.cards[0].id,id);
    assert.equal(family.headers.get('cache-control'),'no-store');
    const stored=app.store.db.prepare('SELECT salt,password_hash FROM auth_users').get();
    assert.match(stored.salt,/^[a-f0-9]{64}$/);
    assert.match(stored.password_hash,/^[a-f0-9]{128}$/);
    assert(!JSON.stringify(stored).includes(password));
    assert(!JSON.stringify(app.store.db.prepare('SELECT secret_hash FROM auth_sessions').all()).includes(cookie.split('=')[1]));
    await app.close();
    app=await createApp({dataDir,publicHost:host,requireAccount:true});
    await start();
    assert.equal((await request('/api/family',{headers:authHeaders})).status,200);
    assert.equal((await redeemCode(restartCode)).status,303);
    const revokedWithSession=await readCode();
    assert.equal((await request('/api/account/logout',{method:'POST',headers:{...authHeaders,Origin:origin}})).status,200);
    assert.equal((await redeemCode(revokedWithSession)).status,401);
    assert.equal((await request('/api/family',{headers:authHeaders})).status,401);
    const operatorCode=openAuth(app.store.db).createLoginCode(email);
    assert.equal((await redeemCode(operatorCode)).status,303);
    const login=await request('/api/account/login',{body:{email,password},headers:{'X-Medika-Client-IP':'192.0.2.2'}});
    assert.equal(login.status,200);
    const newCookie=login.headers.get('set-cookie').split(';')[0];
    assert.notEqual(newCookie,cookie);
    const duplicateInvite=openAuth(app.store.db).invite();
    assert.equal((await request('/api/account/register',{body:{...credentials,invite:duplicateInvite},headers:{'X-Medika-Client-IP':'192.0.2.2'}})).status,409);
    assert.equal(openAuth(app.store.db).revoke(email),true);
    assert.equal((await request('/api/session',{headers:{Cookie:newCookie}})).status,401);
    for(let i=0;i<8;i++)assert.equal((await request('/api/account/register',{body:{email:'rate-limit@example.test',password:'short'},headers:{'X-Medika-Client-IP':'192.0.2.3'}})).status,400);
    assert.equal((await request('/api/account/register',{body:{email:'rate-limit@example.test',password:'short'},headers:{'X-Medika-Client-IP':'192.0.2.3'}})).status,429);
  }finally{
    await app.close();
    await rm(dataDir,{recursive:true,force:true});
  }
});
