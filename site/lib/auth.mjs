import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {assert,InputError} from './domain.mjs';

const derive=promisify(scrypt);
const minute=60_000, day=24*60*minute;
const cookieName='__Host-medika';
const hexToken=/^[a-f0-9]{64}$/;
const randomToken=()=>randomBytes(32).toString('hex');
const digest=value=>createHash('sha256').update(value).digest('hex');
const passwordHash=(password,salt)=>derive(password,salt,64,{N:2**17,r:8,p:1,maxmem:160*1024*1024});
const dummySalt=randomToken();

export function sameToken(expected,provided){
  return typeof provided==='string'&&hexToken.test(provided)&&timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(provided,'hex'));
}
export const sessionCookie=(value='',lifetime=7*24*60*60)=>`${cookieName}=${value}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${lifetime}`;

export function openAuth(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users(
      username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_invites(
      secret_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions(
      secret_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES auth_users(username) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_session_expiry ON auth_sessions(expires_at);
  `);
  const attempts=new Map();
  let hashing=0;

  function useAttempt(key,max,window,now){
    const current=attempts.get(key);
    const entry=current?.until>now?current:{count:0,until:now+window};
    assert(entry.count<max,'Слишком много попыток. Попробуйте позже.',429);
    entry.count++;
    attempts.set(key,entry);
  }
  function credentials(input,ip,register){
    const now=Date.now();
    for(const [key,entry] of attempts)if(entry.until<=now)attempts.delete(key);
    assert(attempts.size<10_000,'Слишком много попыток. Попробуйте позже.',429);
    useAttempt('global',90,minute,now);
    useAttempt('ip:'+ip,12,15*minute,now);
    const username=typeof input.username==='string'?input.username.trim().toLowerCase():'';
    assert(/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username),'Логин — 3–40 латинских букв, цифр, точек, дефисов или подчёркиваний');
    useAttempt('user:'+username,8,15*minute,now);
    const {password}=input;
    assert(typeof password==='string'&&password.length<=256&&password.isWellFormed()&&[...password].length<=128&&[...password].length>=(register?15:1),
      register?'Пароль должен содержать от 15 до 128 символов':'Проверьте логин и пароль');
    return {username,password};
  }
  async function hash(password,salt){
    if(hashing>=2)throw new InputError('Сервер занят. Попробуйте через несколько секунд.',429);
    hashing++;
    try{return await passwordHash(password,salt);}finally{hashing--;}
  }
  function issue(username){
    const now=Date.now(),secret=randomToken();
    db.prepare('DELETE FROM auth_sessions WHERE expires_at<=? OR last_seen<=?').run(now,now-day);
    db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?)').run(digest(secret),username,randomToken(),now+7*day,now);
    return secret;
  }
  return {
    invite(){
      const secret=randomToken();
      db.prepare('DELETE FROM auth_invites WHERE expires_at<=?').run(Date.now());
      db.prepare('INSERT INTO auth_invites VALUES(?,?)').run(digest(secret),Date.now()+day);
      return secret;
    },
    async register(input,ip){
      const {username,password}=credentials(input,ip,true);
      assert(typeof input.invite==='string'&&hexToken.test(input.invite),'Приглашение недействительно или истекло',403);
      const invitation=digest(input.invite);
      assert(db.prepare('SELECT 1 FROM auth_invites WHERE secret_hash=? AND expires_at>?').get(invitation,Date.now()),'Приглашение недействительно или истекло',403);
      const salt=randomToken(),password_hash=(await hash(password,salt)).toString('hex');
      db.exec('BEGIN IMMEDIATE');
      try{
        assert(db.prepare('DELETE FROM auth_invites WHERE secret_hash=? AND expires_at>?').run(invitation,Date.now()).changes===1,'Приглашение недействительно или истекло',403);
        assert(db.prepare('INSERT OR IGNORE INTO auth_users VALUES(?,?,?)').run(username,salt,password_hash).changes===1,'Этот логин занят',409);
        const session=issue(username);
        db.exec('COMMIT');
        return session;
      }catch(error){db.exec('ROLLBACK');throw error;}
    },
    async login(input,ip){
      const {username,password}=credentials(input,ip,false);
      const user=db.prepare('SELECT salt,password_hash FROM auth_users WHERE username=?').get(username);
      const actual=await hash(password,user?.salt||dummySalt);
      const expected=user?Buffer.from(user.password_hash,'hex'):Buffer.alloc(64);
      assert(timingSafeEqual(actual,expected)&&user,'Проверьте логин и пароль',401);
      attempts.delete('user:'+username);
      return issue(username);
    },
    session(cookie=''){
      const secret=cookie.split(';').map(pair=>pair.trim()).find(pair=>pair.startsWith(cookieName+'='))?.slice(cookieName.length+1);
      if(!secret||!hexToken.test(secret))return null;
      const id=digest(secret),now=Date.now();
      const session=db.prepare('SELECT username,csrf,last_seen FROM auth_sessions WHERE secret_hash=? AND expires_at>? AND last_seen>?').get(id,now,now-day);
      if(!session)return null;
      if(now-session.last_seen>minute)db.prepare('UPDATE auth_sessions SET last_seen=? WHERE secret_hash=?').run(now,id);
      return {...session,id};
    },
    logout(id){db.prepare('DELETE FROM auth_sessions WHERE secret_hash=?').run(id);},
    revoke(username){return db.prepare('DELETE FROM auth_users WHERE username=?').run(username).changes===1;}
  };
}
