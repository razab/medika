import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {assert,InputError} from './domain.mjs';

const derive=promisify(scrypt);
const minute=60_000, day=24*60*minute;
const cookieName='__Host-medika';
const hexToken=/^[a-f0-9]{64}$/;
const emailAddress=/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const legacyUsername=/^[a-z0-9][a-z0-9._-]{2,39}$/;
const randomToken=()=>randomBytes(32).toString('hex');
const loginCodeAlphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const loginCodeLifetime=10*minute;
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
    CREATE TABLE IF NOT EXISTS auth_google(
      subject TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL REFERENCES auth_users(username) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS auth_login_codes(
      secret_hash TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL REFERENCES auth_users(username) ON DELETE CASCADE,
      source_session TEXT REFERENCES auth_sessions(secret_hash) ON DELETE CASCADE, expires_at INTEGER NOT NULL
    );
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
  function limit(ip,scope='password'){
    const now=Date.now();
    for(const [key,entry] of attempts)if(entry.until<=now)attempts.delete(key);
    assert(attempts.size<10_000,'Слишком много попыток. Попробуйте позже.',429);
    useAttempt('global',90,minute,now);
    useAttempt('ip:'+scope+':'+ip,12,15*minute,now);
    return now;
  }
  function readUsername(input,register){
    const identifier=input.email??input.username;
    const username=typeof identifier==='string'?identifier.trim().toLowerCase():'';
    const validEmail=username.length<=254&&username.indexOf('@')<=64&&emailAddress.test(username);
    assert(validEmail||(!register&&legacyUsername.test(username)),register?'Введите корректный email':'Проверьте email и пароль');
    return username;
  }
  function credentials(input,ip,register){
    const now=limit(ip),username=readUsername(input,register);
    useAttempt('user:'+username,8,15*minute,now);
    const {password}=input;
    assert(typeof password==='string'&&password.length<=256&&password.isWellFormed()&&[...password].length<=128&&[...password].length>=(register?15:1),
      register?'Пароль должен содержать от 15 до 128 символов':'Проверьте email и пароль');
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
  function inviteHash(invite){
    assert(typeof invite==='string'&&hexToken.test(invite),'Приглашение недействительно или истекло',403);
    const key=digest(invite);
    assert(db.prepare('SELECT 1 FROM auth_invites WHERE secret_hash=? AND expires_at>?').get(key,Date.now()),'Приглашение недействительно или истекло',403);
    return key;
  }
  function consumeInvite(key){
    assert(db.prepare('DELETE FROM auth_invites WHERE secret_hash=? AND expires_at>?').run(key,Date.now()).changes===1,'Приглашение недействительно или истекло',403);
  }
  function addUser(username,salt,passwordHash){
    assert(db.prepare('INSERT OR IGNORE INTO auth_users VALUES(?,?,?)').run(username,salt,passwordHash).changes===1,'На этот email уже зарегистрирован аккаунт',409);
  }
  function transaction(operation){
    db.exec('BEGIN IMMEDIATE');
    try{
      const result=operation();
      db.exec('COMMIT');
      return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  async function verifyPassword(username,password){
    const user=db.prepare("SELECT salt,password_hash FROM auth_users WHERE username=? AND password_hash<>''").get(username);
    const actual=await hash(password,user?.salt||dummySalt);
    const expected=user?Buffer.from(user.password_hash,'hex'):Buffer.alloc(64);
    assert(timingSafeEqual(actual,expected)&&user,'Проверьте email и пароль',401);
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
      const invitation=inviteHash(input.invite);
      const salt=randomToken(),password_hash=(await hash(password,salt)).toString('hex');
      return transaction(()=>{consumeInvite(invitation);addUser(username,salt,password_hash);return issue(username);});
    },
    async login(input,ip){
      const {username,password}=credentials(input,ip,false);
      await verifyPassword(username,password);
      attempts.delete('user:'+username);
      return issue(username);
    },
    createLoginCode(username,sourceSession=null){
      assert(db.prepare('SELECT 1 FROM auth_users WHERE username=?').get(username),'Аккаунт не найден',404);
      const code=Array.from(randomBytes(12),byte=>loginCodeAlphabet[byte&31]).join('');
      const expiresAt=Date.now()+loginCodeLifetime;
      db.prepare(`INSERT INTO auth_login_codes VALUES(?,?,?,?)
        ON CONFLICT(username) DO UPDATE SET secret_hash=excluded.secret_hash,
        source_session=excluded.source_session, expires_at=excluded.expires_at`
      ).run(digest(code),username,sourceSession,expiresAt);
      return code.match(/.{4}/g).join('-');
    },
    loginWithCode(input,ip){
      const now=limit(ip,'code');
      const code=typeof input==='string'&&input.length<=32?input.replace(/[\s-]/g,'').toUpperCase():'';
      const message='Код неверный, уже использован или истёк. Получите новый код.';
      assert(/^[0-9A-HJKMNP-TV-Z]{12}$/.test(code),message,401);
      return transaction(()=>{
        const account=db.prepare(`DELETE FROM auth_login_codes WHERE secret_hash=? AND expires_at>? AND
          (source_session IS NULL OR EXISTS (SELECT 1 FROM auth_sessions
           WHERE secret_hash=source_session AND expires_at>? AND last_seen>?)) RETURNING username`
        ).get(digest(code),now,now,now-day);
        assert(account,message,401);
        return issue(account.username);
      });
    },
    googleLinked(username){
      return Boolean(db.prepare('SELECT 1 FROM auth_google WHERE username=?').get(username));
    },
    async prepareGoogle(input,ip,session){
      switch(input.mode){
        case 'login':
          limit(ip);
          assert(!session,'Сначала выйдите из аккаунта Медики',409);
          return {mode:'login'};
        case 'register':
          limit(ip);
          assert(!session,'Сначала выйдите из аккаунта Медики',409);
          return {mode:'register',username:readUsername(input,true),invitation:inviteHash(input.invite)};
        case 'link': {
          assert(session,'Войдите в Медику',401);
          const {username,password}=credentials({username:session.username,password:input.password},ip,false);
          await verifyPassword(username,password);
          return {mode:'link',username,sessionId:session.id};
        }
        default: throw new InputError('Неизвестный способ входа',400);
      }
    },
    finishGoogle(flow,subject){
      return transaction(()=>{
        const found=db.prepare('SELECT username FROM auth_google WHERE subject=?').get(subject);
        if(flow.mode==='login'){
          assert(found,'Google ещё не привязан. Войдите по паролю и подключите его в аккаунте или зарегистрируйтесь по приглашению.',401);
          return issue(found.username);
        }
        if(flow.mode==='register'){
          assert(!found,'Этот Google-аккаунт уже привязан. Войдите через Google.',409);
          const username=readUsername(flow,true);
          consumeInvite(flow.invitation);
          addUser(username,'','');
        }
        const binding=db.prepare('SELECT subject FROM auth_google WHERE username=?').get(flow.username);
        assert(!found||found.username===flow.username,'Этот Google-аккаунт уже привязан',409);
        assert(!binding||binding.subject===subject,'К аккаунту Медики уже привязан другой Google-аккаунт',409);
        if(!binding)db.prepare('INSERT INTO auth_google VALUES(?,?)').run(subject,flow.username);
        return issue(flow.username);
      });
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
