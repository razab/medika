import {openStore} from '../lib/store.mjs';
import {openAuth} from '../lib/auth.mjs';

const dataDir=process.env.MEDIKA_DATA_DIR;
const [command,username]=process.argv.slice(2);
if(!dataDir||!(command==='invite'&&!username||command==='revoke'&&/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username||''))){
  console.error('MEDIKA_DATA_DIR=/path/to/medika node scripts/accounts.mjs invite | revoke LOGIN');
  process.exit(2);
}
const store=openStore(dataDir);
try{
  const auth=openAuth(store.db);
  if(command==='invite')console.log(auth.invite());
  else if(!auth.revoke(username)){console.error('Аккаунт не найден');process.exitCode=1;}
}finally{store.close();}
