import {openStore} from '../lib/store.mjs';
import {openAuth} from '../lib/auth.mjs';

const dataDir=process.env.MEDIKA_DATA_DIR;
const [command,username]=process.argv.slice(2);
if(!dataDir||!(command==='invite'&&!username||['revoke','login-code'].includes(command)&&username?.trim())){
  console.error('MEDIKA_DATA_DIR=/path/to/medika node scripts/accounts.mjs invite | revoke EMAIL | login-code EMAIL');
  process.exit(2);
}
const store=openStore(dataDir);
try{
  const auth=openAuth(store.db);
  if(command==='invite')console.log(auth.invite());
  else if(command==='login-code')console.log(auth.createLoginCode(username.trim().toLowerCase()));
  else if(!auth.revoke(username.trim().toLowerCase())){console.error('Аккаунт не найден');process.exitCode=1;}
}catch(error){
  console.error(error.status===404?'Аккаунт не найден':'Не удалось выполнить команду');
  process.exitCode=1;
}finally{store.close();}
