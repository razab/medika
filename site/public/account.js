const form=document.querySelector('#account-form,#registration-form');
const title=document.querySelector('#account-title');
const error=document.querySelector('#account-error');
const register=form.id==='registration-form';
const account=location.pathname==='/account';

async function request(path,options){
  const response=await fetch('/api/'+path,options);
  const data=await response.json();
  if(response.status===401&&account){location.replace('/login');throw Error('Сессия закончилась');}
  if(!response.ok)throw Error(data.error||'Запрос не выполнен');
  return data;
}

async function action(button,run){
  button.disabled=true;
  error.textContent='';
  try{await run();}
  catch(failure){error.textContent=failure.message;}
  finally{button.disabled=false;}
}

if(account){
  title.textContent='Аккаунт';
  form.hidden=true;
  const button=document.querySelector('#account-logout');
  action(button,async()=>{
    const session=await request('session');
    document.querySelector('#account-name').textContent=session.username;
    document.querySelector('#account-details').hidden=false;
    button.addEventListener('click',()=>action(button,async()=>{
      await request('account/logout',{method:'POST',headers:{'X-Medika-Token':session.token}});
      location.replace('/login');
    }));
  });
}else{
  const button=form.querySelector('button');
  form.addEventListener('submit',event=>{
    event.preventDefault();
    action(button,async()=>{
      const fields=new FormData(form);
      const input=register?{
        username:fields.get('new-username'),password:fields.get('new-password'),invite:fields.get('invite').trim()
      }:Object.fromEntries(fields);
      await request('account/'+(register?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      location.replace('/family');
    });
  });
}
