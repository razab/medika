import {directions} from './variants.js';
const root=document.querySelector('#designs');
if(new URLSearchParams(location.search).get('overview')==='1')document.body.classList.add('overview');
let size='phone';
function render(){
  document.body.dataset.size=size;
  root.innerHTML=directions.map(v=>`<article class="design ${v.id}"><header><h2>${v.title}</h2><p>${v.idea}</p></header><div class="preview"><img src="/design-study/round-2/previews/${v.id}-${size}.png" alt="${v.title}, вид ${size==='phone'?'на телефоне':'на iPad'}" width="${size==='phone'?390:1024}" height="${size==='phone'?844:768}"></div><div class="caption"><p class="skill">${v.skill}</p><p>${v.strength}</p><p class="tradeoff">${v.tradeoff}</p><a class="open" href="/design-study/round-2/${v.id}">Попробовать<span class="sr-only"> ${v.title}</span></a></div></article>`).join('');
}
document.querySelector('.size-picker').addEventListener('click',e=>{
  const button=e.target.closest('[data-size]');if(!button)return;
  size=button.dataset.size;
  document.querySelectorAll('[data-size]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});render();
});
render();
