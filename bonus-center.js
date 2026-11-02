/* Isolated QIMEM Bonus Center and silent verified new-player enrollment.
   Existing Bingo screens, keyboard buttons and wallets are unchanged. */
(function(){
 "use strict";
 const tg=window.Telegram?.WebApp,auth=tg?.initData||"";
 if(!auth)return;
 const p=new URLSearchParams(location.search);
 const start=tg?.initDataUnsafe?.start_param||p.get("tgWebAppStartParam")||"";
 const bonusLaunch=["bonus","bonus_history","referral","ref_enter","bonus_help"].includes(start)||/^ref_[a-f0-9]{16}$/.test(start);
 const endpoint="https://qimem-pay.mickeyas2411.workers.dev/api/v1/customer/bonus-center";
 const signup=fetch("https://kimem-bingo-backend.mickeyas2411.workers.dev/api/player/register",{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({initData:auth})
 }).then(async r=>r.ok?await r.json():null).catch(()=>null);
 if(!bonusLaunch)return;
 const add=(parent,tag,text,styles)=>{const e=document.createElement(tag);if(text!==null)e.textContent=text;if(styles)e.style.cssText=styles;parent.append(e);return e};
 const overlay=add(document.body,"div",null,
  "position:fixed;z-index:999999;inset:0;overflow:auto;box-sizing:border-box;background:#081328;color:#f6f7fc;font:14px system-ui,-apple-system,sans-serif;padding:16px");
 overlay.id="qimem-bonus-center";
 const card=add(overlay,"section",null,"max-width:510px;margin:10px auto 30px;border:1px solid #3a526e;border-radius:20px;background:linear-gradient(155deg,#142c4b,#0c1b33);padding:18px;box-shadow:0 18px 60px #0006");
 const top=add(card,"div",null,"display:flex;align-items:center;justify-content:space-between;gap:10px");
 add(top,"strong","🎁 QIMEM BONUS CENTER","font-size:19px;color:#f1cf85");
 const close=add(top,"button","✕","border:1px solid #60738c;border-radius:9px;padding:8px 12px;background:#10233e;color:#fff");
 close.onclick=()=>overlay.remove();
 const status=add(card,"p","የቦነስ መረጃ እየተጫነ ነው…","color:#adbbd1;line-height:1.7");
 const nav=add(card,"div",null,"display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0");
 const tabs=[["bonus_history","📋 Bonus History"],["referral","🎟 My Referral Code"],["ref_enter","✍️ Enter Code"],["bonus_help","ℹ️ How to Earn"]];
 const view=add(card,"section",null,"background:#0a192f;border:1px solid #2b4564;border-radius:14px;padding:14px;min-height:130px");
 let active=tabs.some(x=>x[0]===start)?start:start==="bonus"?"bonus_history":/^ref_/.test(start)?"referral":"bonus_history";
 let profile=null,starting=null;
 const text=(label,value)=>{const line=add(view,"p",null,"margin:12px 0;line-height:1.65");add(line,"strong",label,"color:#e9d096");line.append(document.createTextNode(" "+value));return line};
 const action=(parent,label,handler)=>{const b=add(parent,"button",label,"display:block;width:100%;padding:12px;margin-top:12px;border:0;border-radius:10px;color:#091324;background:#e2ba65;font-weight:700;cursor:pointer");b.onclick=handler;return b};
 const show=()=>{
  view.replaceChildren();
  if(active==="bonus_help"){
   add(view,"h3","ℹ️ How to Earn Bonus");
   text("🎉 Welcome Bonus","አዲስ ተጫዋች ሲመዘገብ 10 ብር አንድ ጊዜ ብቻ ወደ Main Wallet ይገባል።");
   text("🤝 Referral Bonus","Master Admin የሰጠህን Referral Code ለጓደኞችህ አጋራ። የጋበዝከው ተጫዋች የመጀመሪያውን Approved Deposit ሲያደርግ 10% ወደ Main Wallet ይገባል።");
   text("🔐 ጥበቃ","አንድ ተጫዋች አንድ ጋባዥ ብቻ ይኖረዋል። አልተረጋገጠም ወይም የተደጋገመ Deposit ቦነስ አያስገኝም።");
  }else if(active==="bonus_history"){
   add(view,"h3","📋 Bonus History","margin:0 0 14px");
   if(!profile){text("Status","በTelegram እንደገና ክፈት።");return}
   const list=profile.bonusHistory||[];
   text("Welcome Bonus",profile.welcomeReceived?"✅ 10.00 ETB credited":"Not yet credited");
   if(!list.length){text("History","ገና የተረጋገጠ ቦነስ መዝገብ የለም።");return}
   for(const item of list.slice(0,30)){
    const name=item.type==="welcome"?"🎉 Welcome Bonus":item.type==="manual"?"🎁 Player Bonus":"🤝 Referral Bonus";
    const date=Number.isFinite(Date.parse(item.date))?new Date(item.date).toLocaleString("en-GB"):"";
    text(name,item.amountBirr+" ETB · "+date);
   }
  }else if(active==="referral"){
   add(view,"h3","🎟 My Referral Code","margin:0 0 14px");
   if(!profile){text("Status","መገናኘት አልተቻለም።");return}
   if(!profile.code){
    text("Referral Code",profile.codeStatus==="inactive"?"Pending Master Admin activation":"Not issued yet");
    text("Access","Only QIMEM PAY Master Admin can issue or activate referral codes.");
    text("Referral Bonus Paid",profile.earnedBirr+" ETB");
    return;
   }
   text("Your Code",profile.code);
   text("Invited Players",String(profile.invitedCount));
   text("Referral Bonus Paid",profile.earnedBirr+" ETB");
   const input=add(view,"input",null,"width:100%;box-sizing:border-box;border-radius:10px;border:1px solid #577090;background:#0c2239;color:#fff;padding:12px");
   input.value=profile.inviteLink;input.readOnly=true;
   action(view,"📋 Copy Invite Link",async()=>{
    try{await navigator.clipboard.writeText(input.value);status.textContent="✅ Invite Link copied"}catch{input.select();status.textContent="ሊንኩን ኮፒ አድርግ።"}
   });
  }else if(active==="ref_enter"){
   add(view,"h3","✍️ Enter Referral Code","margin:0 0 14px");
   text("Instruction","የጋበዘህን ሰው 16-ፊደል Referral Code ከመጀመሪያ Deposit በፊት አስገባ።");
   if(profile?.isInvited){text("Status","✅ Referral already linked");return}
   const field=add(view,"input",null,"width:100%;box-sizing:border-box;padding:13px;border-radius:10px;background:#07162a;border:1px solid #536b87;color:#fff");
   field.placeholder="Referral Code";
   const save=action(view,"Confirm Referral Code",async()=>{
    const v=field.value.trim().toLowerCase();
    if(!/^[a-f0-9]{16}$/.test(v)){status.textContent="ትክክለኛ 16-ፊደል Referral Code አስገባ።";return}
    save.disabled=true;
    try{
     const result=await requestBonus(v);
     profile=result;show();status.textContent=result.isInvited?"✅ Referral linked":"Code was not accepted. Check your eligibility and code.";
    }catch{status.textContent="መረጃውን ማስቀመጥ አልተቻለም።"}finally{save.disabled=false}
   });
  }
 };
 for(const [id,name] of tabs){const b=add(nav,"button",name,"border:1px solid #3d5776;border-radius:9px;color:#f7f7fc;background:#142e4e;padding:12px 5px;font-size:12px;cursor:pointer");b.onclick=()=>{active=id;show()}}
 async function requestBonus(referralCode){
  const body={initData:auth};if(referralCode)body.referralCode=referralCode;
  const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(!r.ok)throw Error("bonus_unavailable");
  const result=await r.json();if(!result.ok)throw Error("bonus_unavailable");
  return result;
 }
 (async()=>{
  starting=await signup;
  if(starting?.welcomeBonus?.status==="credited")status.textContent="🎉 Welcome Bonus 10.00 ETB ወደ Main Wallet ገብቷል!";
  else status.textContent="Bonus Center · የተረጋገጠ የግል መረጃ";
  try{profile=await requestBonus();show()}catch{status.textContent="Bonus Center አሁን አይገኝም። እንደገና ክፈት።";show()}
 })();
})();
