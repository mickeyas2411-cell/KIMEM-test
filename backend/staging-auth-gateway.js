// Isolated Telegram authentication staging gateway. No Neon or wallet bindings.
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const loginPage=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KIMEM Telegram Login Test</title><script src="https://telegram.org/js/telegram-web-app.js"></script><style>body{font-family:system-ui,sans-serif;background:#101827;color:#f8fafc;margin:0;padding:28px}main{max-width:430px;margin:12vh auto;padding:24px;border:1px solid #334155;border-radius:18px;background:#172338}h1{font-size:23px}p{line-height:1.6;color:#cbd5e1}button{padding:13px 18px;background:#22c55e;border:0;border-radius:10px;font-weight:700;color:#052e16}output{display:block;margin-top:20px;overflow-wrap:anywhere}small{color:#94a3b8}</style></head><body><main><h1>KIMEM · Telegram Login Test</h1><p>This staging page only verifies Telegram login. No payments, cards, or balances are changed.</p><button id="check">Verify Telegram login</button><output id="result" role="status">Ready</output><p><small>Open inside @Kimemtest_bot's Mini App. Never share Telegram initData.</small></p></main><script>const out=document.getElementById('result');const button=document.getElementById('check');button.addEventListener('click',async()=>{const t=window.Telegram?.WebApp;const initData=t?.initData;if(!initData){out.textContent='Not inside a Telegram Mini App, or no signed login data.';return}button.disabled=true;out.textContent='Checking Telegram signature…';try{const r=await fetch('/api/me/bonus-balance',{headers:{Authorization:'tma '+initData},cache:'no-store'});const d=await r.json();if(r.status===503&&d.error==='staging_database_not_connected'){out.textContent='PASS: Telegram login verified. Staging database intentionally disconnected.'}else if(r.status===401){out.textContent='FAIL: '+String(d.error||'unauthorized')+'. Checking reason…';try{const q=await fetch('/diagnostics/auth',{headers:{Authorization:'tma '+initData},cache:'no-store'});const v=await q.json();out.textContent='FAIL: '+String(v.reason||'unknown_auth_failure')}catch{out.textContent='FAIL: Unable to inspect auth reason.'}}else{out.textContent='Unexpected response: '+r.status+' ('+String(d.error||'unknown')+')'}}catch{out.textContent='Network error contacting staging API.'}finally{button.disabled=false}});window.Telegram?.WebApp?.ready();</script></body></html>`;
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
function constantEqual(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function verifyTelegram(initData,token){
 if(!initData||initData.length>8192||!token)return false;
 const pairs=[...new URLSearchParams(initData).entries()];
 if(new Set(pairs.map(([k])=>k)).size!==pairs.length)return false;
 const values=new Map(pairs),hash=values.get('hash');
 if(!hash||!/^[a-f0-9]{64}$/i.test(hash))return false;
 const authDate=Number(values.get('auth_date')),now=Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(authDate)||authDate>now+60||now-authDate>3600)return false;
 const data=pairs.filter(([k])=>k!=='hash').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
 const enc=new TextEncoder();
 const base=await crypto.subtle.importKey('raw',enc.encode('WebAppData'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const secret=await crypto.subtle.sign('HMAC',base,enc.encode(token));
 const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=hex(await crypto.subtle.sign('HMAC',key,enc.encode(data)));
 if(!constantEqual(digest,hash.toLowerCase()))return false;
 try{const user=JSON.parse(values.get('user')||'null');return !!user&&Number.isSafeInteger(user.id)&&user.id>0;}catch{return false;}
}
export default {async fetch(request,env){
 const path=new URL(request.url).pathname;
 if(path==='/health'&&request.method==='GET')return respond({ok:true,service:'kimem-player-api-staging',mode:'auth-only',database:'not_connected',bonus_purchases_enabled:false});
 if(path==='/diagnostics/auth'&&request.method==='GET'){
  const auth=request.headers.get('Authorization')||'';
  if(!auth.startsWith('tma '))return respond({ok:false,reason:'missing_telegram_data'},401);
  if(!env.TELEGRAM_BOT_TOKEN)return respond({ok:false,reason:'server_token_not_configured'},503);
  const raw=auth.slice(4),pairs=[...new URLSearchParams(raw).entries()],values=new Map(pairs);
  if(!raw||raw.length>8192||values.size!==pairs.length)return respond({ok:false,reason:'malformed_telegram_data'},401);
  const timestamp=Number(values.get('auth_date')),now=Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(timestamp)||timestamp>now+60||now-timestamp>3600)return respond({ok:false,reason:'telegram_data_expired'},401);
  if(!/^[a-f0-9]{64}$/i.test(values.get('hash')||''))return respond({ok:false,reason:'missing_or_invalid_hash'},401);
  const verified=await verifyTelegram(raw,env.TELEGRAM_BOT_TOKEN);
  if(!verified){
   const userRaw=values.get('user');let validUser=false;
   try{const u=JSON.parse(userRaw||'null');validUser=!!u&&Number.isSafeInteger(u.id)&&u.id>0;}catch{}
   return respond({ok:false,reason:validUser?'telegram_hash_mismatch':'telegram_user_invalid_or_hash_mismatch'},401);
  }
  return respond({ok:true,reason:'verified'});
 }
 if(path==='/login-test'&&request.method==='GET')return new Response(loginPage,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
 const routes={'/api/me/register':'POST','/api/me/balances':'GET','/api/me/bonus-balance':'GET','/api/cards/buy-bonus':'POST'};
 if(!Object.hasOwn(routes,path))return respond({ok:false,error:'not_found'},404);
 if(request.method!==routes[path])return respond({ok:false,error:'method_not_allowed'},405);
 const auth=request.headers.get('Authorization')||'';
 if(!auth.startsWith('tma ')||!await verifyTelegram(auth.slice(4),env.TELEGRAM_BOT_TOKEN))
  return respond({ok:false,error:'unauthorized'},401);
 if(path==='/api/me/balances')return respond({ok:false,error:'wallet_reconciliation_required'},503);
 if(path==='/api/cards/buy-bonus')return respond({ok:false,error:'bonus_purchases_not_enabled'},503);
 return respond({ok:false,error:'staging_database_not_connected'},503);
}};
