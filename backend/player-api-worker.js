/**
 * QIMEM authenticated player API - staging source, not deployed.
 * Dependencies: @neondatabase/serverless
 * Secrets: TELEGRAM_BOT_TOKEN, DATABASE_URL.
 * Requires migrations 001 and 002. Existing Durable Object wallets must be
 * reconciled before treating Neon real balances as authoritative.
 */
import { neon } from '@neondatabase/serverless';

const json = (body, status=200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
});

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function constantTimeHexEqual(a,b) {
  if (a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function verifyTelegram(initData, token) {
  if (!initData || initData.length>8192 || !token) return null;
  const params=new URLSearchParams(initData);
  const hash=params.get('hash');
  if(!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  const pairs=[...params.entries()];
  if(new Set(pairs.map(([k])=>k)).size!==pairs.length) return null;
  const authDate=Number(params.get('auth_date'));
  const now=Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(authDate)||authDate>now+60||now-authDate>3600) return null;
  const check=pairs.filter(([k])=>k!=='hash')
    .sort(([a],[b])=>a<b?-1:a>b?1:0)
    .map(([k,v])=>k+'='+v).join('\n');
  const enc=new TextEncoder();
  const secret=await crypto.subtle.sign('HMAC',
    await crypto.subtle.importKey('raw',enc.encode('WebAppData'),{name:'HMAC',hash:'SHA-256'},false,['sign']),
    enc.encode(token));
  const key=await crypto.subtle.importKey('raw',secret,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=hex(await crypto.subtle.sign('HMAC',key,enc.encode(check)));
  if(!constantTimeHexEqual(digest,hash.toLowerCase())) return null;
  let user;
  try{user=JSON.parse(params.get('user')||'null');}catch{return null;}
  if(!user||!Number.isSafeInteger(user.id)||user.id<=0) return null;
  return user;
}
function formatMoney(v) {
  const s=String(v);
  if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) throw new Error('invalid money');
  return Number(s).toFixed(2);
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(!['/api/me/register','/api/me/balances','/api/me/bonus-balance','/api/cards/buy-bonus'].includes(url.pathname))
      return json({ok:false,error:'not_found'},404);
    if(request.method!==(['/api/me/balances','/api/me/bonus-balance'].includes(url.pathname)?'GET':'POST'))
      return json({ok:false,error:'method_not_allowed'},405);
    const auth=request.headers.get('Authorization')||'';
    if(!auth.startsWith('tma ')) return json({ok:false,error:'unauthorized'},401);
    const user=await verifyTelegram(auth.slice(4),env.TELEGRAM_BOT_TOKEN);
    if(!user) return json({ok:false,error:'unauthorized'},401);
    if(!env.DATABASE_URL) return json({ok:false,error:'not_configured'},503);
    try {
      const sql=neon(env.DATABASE_URL);
      if(url.pathname.endsWith('/register')) {
        // The single statement commits registration, wallet and bonus together.
        // INSERT/ON CONFLICT relies on migration 002 unique indexes.
        const rows=await sql`
          WITH player AS (
            INSERT INTO qimem_players(telegram_id,username,first_name,last_name)
            VALUES (${user.id},${user.username||null},${user.first_name||null},${user.last_name||null})
            ON CONFLICT(telegram_id) DO UPDATE SET
              username=EXCLUDED.username,first_name=EXCLUDED.first_name,
              last_name=EXCLUDED.last_name,updated_at=now()
            RETURNING id
          ),
          wallet AS (
            INSERT INTO qimem_wallets(player_id,available_balance,held_balance)
            SELECT id,0,0 FROM player ON CONFLICT(player_id) DO NOTHING
            RETURNING player_id
          ),
          bonus AS (
            INSERT INTO qimem_registration_bonus_accounts(player_id,granted_amount,available_amount)
            SELECT id,10.00,10.00 FROM player ON CONFLICT(player_id) DO NOTHING
            RETURNING player_id,granted_amount
          ),
          bonus_log AS (
            INSERT INTO qimem_registration_bonus_transactions(player_id,amount,reason)
            SELECT player_id,granted_amount,'registration_grant' FROM bonus
            RETURNING player_id
          )
          SELECT player.id,EXISTS(SELECT 1 FROM bonus_log) AS bonus_newly_granted
          FROM player
        `;
        return json({ok:true,registered:true,bonus_newly_granted:rows[0]?.bonus_newly_granted===true});
      }

      if(url.pathname==='/api/cards/buy-bonus') {
        // Fail closed: live round price/type is not yet reconciled with Neon.
        // Never charge a bonus against a 20 ETB room or unknown round.
        if(true)
          return json({ok:false,error:'bonus_purchases_not_enabled'},503);
        if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
          return json({ok:false,error:'invalid_content_type'},415);
        const raw=await request.text();
        if(raw.length>2048) return json({ok:false,error:'payload_too_large'},413);
        let body;
        try { body=JSON.parse(raw); } catch { return json({ok:false,error:'invalid_json'},400); }
        const {round_id,card_number,request_key}=body||{};
        if(!Number.isSafeInteger(round_id)||round_id<=0||
           !Number.isSafeInteger(card_number)||card_number<=0||
           typeof request_key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(request_key))
          return json({ok:false,error:'invalid_purchase_request'},400);
        const players=await sql`SELECT id FROM qimem_players WHERE telegram_id=${user.id}`;
        if(players.length!==1) return json({ok:false,error:'registration_required'},409);
        try {
          const rows=await sql`
            SELECT purchase_id,card_id,charged
            FROM qimem_buy_10etb_bonus_card(${players[0].id},${round_id},${card_number},${request_key})
          `;
          if(rows.length!==1) return json({ok:false,error:'purchase_not_completed'},503);
          return json({ok:true,purchase:{
            id:String(rows[0].purchase_id),
            card_id:String(rows[0].card_id),
            charged:rows[0].charged===true
          }});
        } catch(e) {
          console.error('QIMEM bonus purchase failed',e?.name||'Error');
          return json({ok:false,error:'purchase_rejected'},409);
        }
      }

      if(url.pathname==='/api/me/bonus-balance') {
        // Only the dedicated registration bonus is authoritative in Neon.
        // Never imply that this is the live real-money wallet balance.
        const rows=await sql`
          SELECT a.available_amount::text AS bonus_etb
          FROM qimem_players p
          JOIN qimem_registration_bonus_accounts a ON a.player_id=p.id
          WHERE p.telegram_id=${user.id}
        `;
        if(rows.length!==1) return json({ok:false,error:'registration_required'},409);
        return json({ok:true,bonus_etb:formatMoney(rows[0].bonus_etb)});
      }
      // Deliberately DO NOT return Neon real balance yet: live wallet may
      // be authoritative in Cloudflare Durable Objects. Fail closed until reconciled.
      return json({ok:false,error:'wallet_reconciliation_required'},503);
    }catch(e) {
      console.error('QIMEM player API failure',e?.name||'Error');
      return json({ok:false,error:'service_unavailable'},503);
    }
  }
};
