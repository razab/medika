const form=document.querySelector('#account-form,#registration-form');
const error=document.querySelector('#account-error');
const register=form?.id==='registration-form';
const account=location.pathname==='/account';
const googleMessages={
  cancelled:'Вход через Google отменён.',
  unlinked:'Google ещё не подключён. Войдите по паролю и подключите его в аккаунте или зарегистрируйтесь по приглашению.',
  conflict:'Email уже зарегистрирован или Google уже привязан. Попробуйте войти.',
  invalid:'Не удалось подтвердить вход. Если вы регистрируетесь, проверьте код приглашения.',
  unavailable:'Вход через Google временно недоступен.'
};

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

async function startGoogle(input,csrf){
  const response=await fetch('/auth/google/start',{
    method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'X-Medika-Token':csrf}:{})},body:JSON.stringify(input)
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.error||googleMessages.unavailable);
  location.assign(data.location);
}

function showGoogleError(){
  const reason=new URLSearchParams(location.search).get('google');
  if(Object.hasOwn(googleMessages,reason)){
    error.textContent=googleMessages[reason];
    history.replaceState(null,'',location.pathname);
  }
}

if(account){
  const button=document.querySelector('#account-logout');
  action(button,async()=>{
    const session=await request('session');
    document.querySelector('#account-name').textContent=session.username;
    document.querySelector('#account-details').hidden=false;
    button.addEventListener('click',()=>action(button,async()=>{
      await request('account/logout',{method:'POST',headers:{'X-Medika-Token':session.token}});
      location.replace('/login');
    }));
    const providers=await request('account/providers');
    if(providers.google){
      document.querySelector('#google-linked').hidden=!providers.linked;
      const details=document.querySelector('#google-link');
      details.hidden=providers.linked;
      const linkForm=details.querySelector('form');
      linkForm.addEventListener('submit',event=>{
        event.preventDefault();
        action(linkForm.querySelector('button'),async()=>{
          await startGoogle({mode:'link',password:linkForm.elements.password.value},session.token);
          linkForm.reset();
        });
      });
    }
    showGoogleError();
  });
}else{
  if(register){
    const passwordActions=form.querySelectorAll('.password-actions button');
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
    form.addEventListener('submit',event=>{
      event.preventDefault();
      action(form.querySelector('button[type="submit"]'),async()=>{
        passwordActions.forEach(control=>control.disabled=true);
        try{
          const fields=new FormData(form);
          const input={email:fields.get('email'),password:fields.get('new-password'),invite:fields.get('invite').trim()};
          await request('account/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
          location.replace('/family');
        }finally{
          passwordActions.forEach(control=>control.disabled=false);
        }
      });
    });
  }
  showGoogleError();
  request('account/providers').then(providers=>{
    if(!providers.google)return;
    const googleButton=document.querySelector(register?'#google-register':'#google-login');
    googleButton.hidden=false;
    googleButton.addEventListener('click',()=>{
      if(register&&![form.elements.email,form.elements.invite].every(field=>field.reportValidity()))return;
      action(googleButton,()=>startGoogle(register?{
        mode:'register',email:form.elements.email.value,invite:form.elements.invite.value.trim()
      }:{mode:'login'}));
    });
  }).catch(()=>{});
}
