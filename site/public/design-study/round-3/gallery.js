import {directions} from './variants.js';
const root=document.querySelector('#designs');
const query=new URLSearchParams(location.search);
let size=['phone','tablet','large'].includes(query.get('size'))?query.get('size'):'phone';
if(query.get('overview')==='1')document.body.classList.add('overview');
function render(){
 document.body.dataset.size=size;
 root.innerHTML=directions.map((v,i)=>`<article class="design ${v.id}"><header><h2>${v.title}</h2><p>${v.idea}</p></header><div class="preview"><img src="/design-study/round-3/previews/${v.id}-${size}.png" width="${size==='tablet'?1194:390}" height="${size==='tablet'?834:844}" alt="${v.title}, ${size==='tablet'?'iPad':size==='large'?'iPhone с увеличенным текстом':'iPhone'}"></div><div class="caption"><p class="skill">Вариант ${i+1}</p><p>${v.strength}</p><p class="tradeoff">${v.tradeoff}</p><a class="open" href="/design-study/round-3/${v.id}${size==='large'?'?text=large':''}">Попробовать<span class="sr-only"> ${v.title}</span></a></div></article>`).join('');
 document.querySelectorAll('[data-size]').forEach(b=>{const active=b.dataset.size===size;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
}
document.querySelector('.size-picker').addEventListener('click',e=>{const button=e.target.closest('[data-size]');if(!button)return;size=button.dataset.size;render();});
render();
