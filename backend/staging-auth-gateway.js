// Isolated Telegram authentication staging gateway.
// No Neon, wallets, Durable Objects, or game-round mutations.
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
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
