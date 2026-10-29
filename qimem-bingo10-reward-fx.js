// QIMEM BINGO 10: verified-only reward heartbeat and payout celebration.
(()=>{
'use strict';
const root=document.getElementById('lobby-main')||document.getElementById('live-main');
const row=root?.querySelector('.bonus-row');
if(!row)return;
const kinds=['daily','weekly','jackpot'];
const buttons=[...row.children].filter(e=>e.tagName==='BUTTON');
if(buttons.length!==3)return;
const target=Object.fromEntries(kinds.map((k,i)=>[k,buttons[i]]));
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
const css=document.createElement('style');
css.textContent=`
@keyframes qRewardBeat{0%,100%{filter:brightness(1)}38%{filter:brightness(1.3)}54%{filter:brightness(1.04)}69%{filter:brightness(1.3)}}
@keyframes qRewardBurst{0%,100%{filter:brightness(1);transform:scale(1)}45%{filter:brightness(1.7);transform:scale(1.035)}}
@keyframes qRewardSpark{0%{opacity:1;transform:translate(-50%,-50%) scale(.4)}100%{opacity:0;transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) scale(1.3)}}
.q-reward-heartbeat{animation:qRewardBeat var(--beat,1s) ease-in-out infinite!important}
.q-reward-burst{animation:qRewardBurst .6s ease-in-out 4!important;position:relative!important}
.q-reward-spark{position:absolute!important;left:50%;top:50%;width:5px;height:5px;background:#ffe9a6;border-radius:50%;box-shadow:0 0 8px #ffcf4b;z-index:10;pointer-events:none;animation:qRewardSpark 1s ease-out both!important}
#q-reward-notice{position:fixed;z-index:2000;left:50%;top:calc(20px + env(safe-area-inset-top,0px));transform:translateX(-50%);background:#302307f5;border:1px solid #e3b75e;border-radius:12px;color:#ffe3a6;max-width:90vw;padding:10px 16px;font:bold 13px system-ui;text-align:center;box-shadow:0 6px 30px #000b;pointer-events:none;opacity:0;transition:opacity .2s}
#q-reward-notice.show{opacity:1}
@media(prefers-reduced-motion:reduce){.q-reward-heartbeat,.q-reward-burst,.q-reward-spark{animation:none!important}}
`;
document.head.append(css);
const notice=document.createElement('div');notice.id='q-reward-notice';notice.setAttribute('role','status');document.body.append(notice);
let rules=[],seen=new Set(),loaded=false,busy=false,noticeTimer=0;
function localTime(){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Addis_Ababa',hourCycle:'h23',weekday:'short',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return {day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday),minutes:+p.hour*60+(+p.minute)};
}
function pulse(){
 const t=localTime();
 for(const k of kinds){
  const button=target[k],r=rules.find(x=>x.kind===k);
  let speed=null;
  if(!document.hidden&&!reduce.matches&&r?.enabled===true){
   const balance=Number(r.availableBirr),min=Number(r.minFund);
   if(Number.isFinite(balance)&&Number.isFinite(min)&&min>0){
    if(k==='jackpot'){if(balance>=min)speed='.52s';else if(balance>=min*.75)speed='.78s';else if(balance>=min*.5)speed='1.1s';}
    else if(balance>=min&&(k!=='weekly'||Number(r.weeklyDay)===t.day)){
     const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(r.drawTime||''));
     if(match){const diff=+match[1]*60+(+match[2])-t.minutes;if(diff>=0&&diff<=180)speed=diff<=5?'.42s':diff<=20?'.72s':'1.25s';}
    }
   }
  }
  button.classList.toggle('q-reward-heartbeat',!!speed);
  if(speed)button.style.setProperty('--beat',speed);else button.style.removeProperty('--beat');
 }
}
function celebrate(ev){
 const button=target[ev.kind];if(!button||document.hidden)return;
 button.classList.remove('q-reward-heartbeat','q-reward-burst');void button.offsetWidth;
 button.classList.add('q-reward-burst');
 if(!reduce.matches){
  for(let i=0;i<10;i++){
   const a=i*Math.PI/5,part=document.createElement('span');part.className='q-reward-spark';
   part.style.setProperty('--x',Math.round(Math.cos(a)*36)+'px');part.style.setProperty('--y',Math.round(Math.sin(a)*26)+'px');
   button.append(part);setTimeout(()=>part.remove(),1100);
  }
 }
 const amount=Number(ev.prizeBirr),card=Number(ev.winningCard);
 notice.textContent=ev.kind.toUpperCase()+' WINNER'+(Number.isInteger(card)&&card>0?' · CARD #'+card:'')+(Number.isFinite(amount)&&amount>0?' · '+amount.toFixed(2)+' ETB':'');
 notice.classList.add('show');clearTimeout(noticeTimer);
 noticeTimer=setTimeout(()=>notice.classList.remove('show'),4400);
 setTimeout(()=>{button.classList.remove('q-reward-burst');pulse()},2700);
}
async function refresh(){
 if(busy||document.hidden)return;busy=true;
 try{
  const res=await fetch('https://qimem-pay.mickeyas2411.workers.dev/api/v1/public/bingo10/rewards',{cache:'no-store'});
  if(!res.ok)return;
  const data=await res.json();
  if(data?.ok!==true||data?.funds?.source!=='verified_paid_rounds_after_cutover'||!Array.isArray(data.funds.rewards)||!Array.isArray(data.events))return;
  rules=data.funds.rewards.filter(x=>kinds.includes(x.kind));
  const events=data.events.filter(x=>kinds.includes(x.kind)&&typeof x.id==='string');
  if(loaded){for(const e of events.slice().reverse())if(!seen.has(e.id))celebrate(e);}
  seen=new Set(events.map(x=>x.id));loaded=true;pulse();
 }catch{}finally{busy=false}
}
document.addEventListener('visibilitychange',()=>{pulse();if(!document.hidden)refresh()});
reduce.addEventListener?.('change',pulse);
setInterval(pulse,1000);setInterval(refresh,12000);refresh();
})();