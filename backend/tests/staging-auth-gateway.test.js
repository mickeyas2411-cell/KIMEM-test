import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import gateway from '../staging-auth-gateway.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const token = 'local-test-token-not-a-real-secret';
const base = 'https://staging.example';
const call = (path, method='GET', auth, env={TELEGRAM_BOT_TOKEN:token}) =>
  gateway.fetch(new Request(base+path,{method,headers:auth?{Authorization:'tma '+auth}:{}}),env);
async function signedInitData({time=Math.floor(Date.now()/1000),user={id:123456789,first_name:'Test'},extras={}}={}) {
 const p=new URLSearchParams({auth_date:String(time),user:JSON.stringify(user),...extras});
 const data=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
 const e=new TextEncoder();
 const baseKey=await crypto.subtle.importKey('raw',e.encode('WebAppData'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const secret=await crypto.subtle.sign('HMAC',baseKey,e.encode(token));
 const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',key,e.encode(data));
 p.set('hash',Buffer.from(digest).toString('hex'));
 return p.toString();
}
test('staging health never reports a connected database',async()=>{
 const r=await call('/health');
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.database,'not_connected');
 assert.equal(data.bonus_purchases_enabled,false);
});
test('protected endpoint requires signed Telegram initData',async()=>{
 assert.equal((await call('/api/me/bonus-balance')).status,401);
 const valid=await signedInitData();
 const r=await call('/api/me/bonus-balance','GET',valid);
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,'staging_database_not_connected');
});
test('invalid signature and duplicated auth_date are rejected',async()=>{
 const valid=await signedInitData();
 assert.equal((await call('/api/me/bonus-balance','GET',valid.replace('123456789','123456788'))).status,401);
 assert.equal((await call('/api/me/bonus-balance','GET',valid+'&auth_date=1')).status,401);
});
test('expired initData and invalid Telegram user are rejected',async()=>{
 const old=await signedInitData({time:Math.floor(Date.now()/1000)-7200});
 assert.equal((await call('/api/me/bonus-balance','GET',old)).status,401);
 const invalid=await signedInitData({user:{id:-1}});
 assert.equal((await call('/api/me/bonus-balance','GET',invalid)).status,401);
});
test('valid auth cannot buy cards or read unreconciled wallet',async()=>{
 const valid=await signedInitData();
 const buy=await call('/api/cards/buy-bonus','POST',valid);
 assert.equal(buy.status,503);
 assert.equal((await buy.json()).error,'bonus_purchases_not_enabled');
 const wallet=await call('/api/me/balances','GET',valid);
 assert.equal(wallet.status,503);
 assert.equal((await wallet.json()).error,'wallet_reconciliation_required');
});
test('missing bot secret fails closed',async()=>{
 const valid=await signedInitData();
 assert.equal((await call('/api/me/bonus-balance','GET',valid,{})).status,401);
});
