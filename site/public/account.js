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
  const button=form.querySelector('button[type="submit"]');
  const passwordActions=form.querySelectorAll('.password-actions button');
  if(register){
    const [generate,copy]=passwordActions;
    const field=form.elements['new-password'];
    const status=document.querySelector('#password-status');
    generate.addEventListener('click',()=>{
      const bytes=crypto.getRandomValues(new Uint8Array(24));
      field.value=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_');
      copy.hidden=false;
      status.textContent='Скопируйте и сохраните пароль перед регистрацией.';
    });
    copy.addEventListener('click',async()=>{
      try{
        await navigator.clipboard.writeText(field.value);
        status.textContent='Пароль скопирован.';
      }catch{
        status.textContent='Браузер не разрешил копирование. Можно ввести свой пароль.';
      }
    });
    field.addEventListener('input',()=>{
      copy.hidden=true;
      status.textContent='';
    });
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    action(button,async()=>{
      passwordActions.forEach(control=>control.disabled=true);
      try{
        const fields=new FormData(form);
        const input=register?{
          username:fields.get('new-username'),password:fields.get('new-password'),invite:fields.get('invite').trim()
        }:Object.fromEntries(fields);
        await request('account/'+(register?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
        location.replace('/family');
      }finally{
        passwordActions.forEach(control=>control.disabled=false);
      }
    });
  });
}
