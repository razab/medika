import {createHash,createPublicKey,randomBytes,verify} from 'node:crypto';
import {assert,InputError} from './domain.mjs';

const authURL='https://accounts.google.com/o/oauth2/v2/auth';
const tokenURL='https://oauth2.googleapis.com/token';
const keysURL='https://www.googleapis.com/oauth2/v3/certs';
export const googleCallback='/auth/google/callback';
const cookieName='__Host-medika-google';
const lifetime=10*60;
const token=()=>randomBytes(32).toString('base64url');
const sha=value=>createHash('sha256').update(value).digest('base64url');
const randomPattern=/^[a-zA-Z0-9_-]{43}$/;
const validSegment=/^[a-zA-Z0-9_-]+$/;
export const googleCookie=(value='',age=lifetime)=>`${cookieName}=${value}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}`;

export function createGoogleAuth(db,{clientId,clientSecret,publicHost,fetchGoogle=fetch}){
  if(!clientId&&!clientSecret)return null;
  assert(typeof clientId==='string'&&/^[a-zA-Z0-9_-]{1,200}\.apps\.googleusercontent\.com$/.test(clientId)&&
    typeof clientSecret==='string'&&/^[a-zA-Z0-9_-]{8,255}$/.test(clientSecret),'Некорректная конфигурация Google OAuth',500);
  const redirectUri='https://'+publicHost+googleCallback;
  db.exec(`CREATE TABLE IF NOT EXISTS auth_google_flows(
    secret_hash TEXT PRIMARY KEY, state_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, flow TEXT NOT NULL
  )`);
  let keys,validUntil=0;
  async function googleJSON(url,options){
    let response;
    try{
      response=await fetchGoogle(url,{...options,signal:AbortSignal.timeout(8000),redirect:'error'});
      if(response.ok)return await response.json();
    }catch{}
    throw new InputError('Вход через Google временно недоступен',502);
  }
  async function checkIdentity(idToken,nonce){
    assert(typeof idToken==='string'&&idToken.length<=16000,'Google не подтвердил вход',403);
    const parts=idToken.split('.');
    assert(parts.length===3&&parts.every(part=>validSegment.test(part)),'Google не подтвердил вход',403);
    let header, claims;
    try{
      [header,claims]=parts.slice(0,2).map(part=>JSON.parse(Buffer.from(part,'base64url')));
    }catch{throw new InputError('Google не подтвердил вход',403);}
    const now=Math.floor(Date.now()/1000);
    assert(header?.alg==='RS256'&&typeof header.kid==='string'&&header.kid.length<=120&&
      ['https://accounts.google.com','accounts.google.com'].includes(claims?.iss)&&claims.aud===clientId&&
      (!claims.azp||claims.azp===clientId)&&claims.nonce===nonce&&Number.isInteger(claims.exp)&&claims.exp>now&&
      Number.isInteger(claims.iat)&&claims.iat<=now+60&&typeof claims.sub==='string'&&/^[!-~]{1,255}$/.test(claims.sub),
      'Google не подтвердил вход',403);
    if(!keys||Date.now()>=validUntil){
      const response=await googleJSON(keysURL);
      assert(Array.isArray(response?.keys),'Вход через Google временно недоступен',502);
      keys=response.keys;validUntil=Date.now()+5*60_000;
    }
    const key=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');
    assert(key&&verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')),
      'Google не подтвердил вход',403);
    return claims.sub;
  }
  return {
    start(flow){
      const secret=token(),state=token(),nonce=token(),verifier=token(),now=Date.now();
      db.prepare('DELETE FROM auth_google_flows WHERE expires_at<=?').run(now);
      db.prepare('INSERT INTO auth_google_flows VALUES(?,?,?,?)').run(sha(secret),sha(state),now+lifetime*1000,JSON.stringify({...flow,nonce,verifier}));
      const query=new URLSearchParams({
        client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid',state,nonce,
        code_challenge:sha(verifier),code_challenge_method:'S256',prompt:'select_account'
      });
      return {location:authURL+'?'+query,cookie:googleCookie(secret)};
    },
    take(cookie='',state){
      const secret=cookie.split(';').map(part=>part.trim()).find(part=>part.startsWith(cookieName+'='))?.slice(cookieName.length+1);
      assert(randomPattern.test(secret||'')&&typeof state==='string'&&randomPattern.test(state),'Запрос входа истёк',403);
      const row=db.prepare('DELETE FROM auth_google_flows WHERE secret_hash=? AND state_hash=? AND expires_at>? RETURNING flow').get(sha(secret),sha(state),Date.now());
      assert(row,'Запрос входа истёк',403);
      return JSON.parse(row.flow);
    },
    async exchange(code,flow){
      assert(typeof code==='string'&&code.length>0&&code.length<=2048,'Google не подтвердил вход',403);
      const body=new URLSearchParams({
        code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code',code_verifier:flow.verifier
      });
      const response=await googleJSON(tokenURL,{method:'POST',body});
      return checkIdentity(response?.id_token,flow.nonce);
    }
  };
}
