const form=document.querySelector('#account-form');
const title=document.querySelector('#account-title');
const error=document.querySelector('#account-error');
const register=location.pathname==='/register';
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
  if(register){
    title.textContent=button.textContent='Создать аккаунт';
    form.elements.password.autocomplete='new-password';
    form.elements.password.minLength=15;
    const invite=form.elements.invite;
    invite.disabled=false;
    invite.required=true;
    invite.minLength=64;
    document.querySelector('#account-invite').hidden=false;
    const switchPage=document.querySelector('#account-switch');
    switchPage.href='/login';
    switchPage.textContent='Уже есть аккаунт? Войти';
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    action(button,async()=>{
      const input=Object.fromEntries(new FormData(form));
      if(register)input.invite=input.invite.trim();
      await request('account/'+(register?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      location.replace('/family');
    });
  });
}
