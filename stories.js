'use strict';
(() => {
const $ = id => document.getElementById(id);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const deck=$('deck'), cards=[...deck.querySelectorAll('.story')], dialog=$('story-dialog');
const clips=cards.map(card=>card.querySelector('video'));
let active=0, drag=null, ignoreClick=false, deckVisible=false, videoEnabled=!reduced.matches;

function syncClips(){
  $('video-toggle').textContent=videoEnabled?'Пауза видео':'Включить видео';
  clips.forEach((clip,i)=>{
    if(i!==active||!deckVisible||!videoEnabled||document.hidden||dialog.open){
      clip.pause();
      return;
    }
    if(!clip.hasAttribute('src'))clip.src=clip.dataset.src;
    clip.muted=true;
    if(clip.paused)clip.play().catch(error=>{
      if(error.name!=='AbortError'&&i===active&&deckVisible&&videoEnabled&&clip.paused&&!document.hidden&&!dialog.open){
        videoEnabled=false;
        $('video-toggle').textContent='Включить видео';
      }
    });
  });
}

$('video-toggle').onclick=()=>{videoEnabled=!videoEnabled;syncClips();};
reduced.addEventListener('change',()=>{videoEnabled=!reduced.matches;syncClips();});
document.addEventListener('visibilitychange',syncClips);
dialog.addEventListener('close',syncClips);
if('IntersectionObserver' in window){
  new IntersectionObserver(([entry])=>{deckVisible=entry.intersectionRatio>=.42;syncClips();},
    {threshold:.42}).observe(deck);
}else{
  deckVisible=true;
}
function move(delta){
  const next=active+delta;
  if (next<0||next>=cards.length) return;
  deck.style.setProperty('--outgoing',delta>0?'-30%':'30%');
  deck.style.setProperty('--outgoing-tilt',delta>0?'-6deg':'6deg');
  active=next;
  updateDeck();
}
function updateDeck(){
  cards.forEach((card,i)=>{
    card.dataset.depth=String(i<active?-1:i-active);
    card.inert=i!==active;
    card.setAttribute('aria-hidden',String(i!==active));
  });
  $('deck-count').textContent=(active+1)+' / '+cards.length;
  $('prev').disabled=active===0; $('next').disabled=active===cards.length-1;
  syncClips();
}
$('prev').onclick=()=>move(-1); $('next').onclick=()=>move(1);
deck.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}};
deck.onpointerdown=e=>{
  ignoreClick=false;
  if(e.button!==0||e.target.closest('button'))return;
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0};
};
deck.onpointermove=e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
  if(!deck.classList.contains('dragging')){
    if(Math.abs(dx)<8||Math.abs(dy)>Math.abs(dx))return;
    deck.setPointerCapture(e.pointerId);
    deck.classList.add('dragging');
  }
  drag.dx=dx;
  if(!reduced.matches){
    deck.style.setProperty('--drag',dx*.82+'px');
    deck.style.setProperty('--tilt',Math.max(-8,Math.min(8,dx/21))+'deg');
  }
};
function endDrag(e){
  if(!drag||drag.id!==e.pointerId)return;
  const dx=drag.dx;
  drag=null;
  ignoreClick=Math.abs(dx)>8;
  deck.classList.remove('dragging');
  deck.style.removeProperty('--drag');deck.style.removeProperty('--tilt');
  if(e.type==='pointerup'&&Math.abs(dx)>47)move(dx<0?1:-1);
}
deck.onpointerup=endDrag;deck.onpointercancel=endDrag;
deck.addEventListener('click',e=>{if(ignoreClick){e.preventDefault();e.stopPropagation();ignoreClick=false;}},true);
for(const button of document.querySelectorAll('[data-open]'))button.onclick=()=>{
  openStory(button.dataset.open);
};
function openStory(id){
  const template=$('detail-'+id);
  if(!template)return;
  $('story-kicker').textContent=template.dataset.kicker;
  $('story-title').textContent=template.dataset.title;
  $('story-copy').replaceChildren(template.content.cloneNode(true));
  $('story-share').dataset.share=id;
  if(!dialog.open)dialog.showModal();
  syncClips();
}
function showSharedStory(){
  const id=location.hash.slice(1);
  const index=cards.findIndex(card=>card.id===id);
  if(index===-1)return;
  active=index;
  updateDeck();
  $('achievements').scrollIntoView({behavior:'instant'});
  openStory(id);
}
window.addEventListener('hashchange',showSharedStory);
dialog.addEventListener('click',e=>{if(e.target!==dialog)return; const r=dialog.getBoundingClientRect();
 if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();
});
updateDeck();
showSharedStory();
const goal=document.querySelector('.goal');
if('IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>{if(entries[0].isIntersecting){goal.classList.add('in-view');observer.disconnect();}},{threshold:.28});
  observer.observe(goal);
}
let frame=0;
const hero=document.querySelector('.hero');
function handleScroll(){
  if(frame)return;
  frame=requestAnimationFrame(()=>{frame=0;hero.style.setProperty('--photo-y',reduced.matches?'0px':Math.min(scrollY,hero.offsetHeight)*.07+'px');});
}
addEventListener('scroll',handleScroll,{passive:true});
})();
