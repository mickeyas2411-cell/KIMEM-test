import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../player-api-worker.js',import.meta.url),'utf8');
test('Telegram verification precedes purchases',()=>{
 assert.ok(source.indexOf('verifyTelegram(auth.slice(4)')<source.indexOf("if(url.pathname==='/api/cards/buy-bonus')"));
});
test('purchase calls atomic database function',()=>{
 assert.match(source,/qimem_buy_10etb_bonus_card\(/);
 assert.match(source,/WHERE telegram_id=\$\{user\.id\}/);
});
test('unreconciled real balance is not returned',()=>{
 assert.match(source,/wallet_reconciliation_required/);
});

test('bonus purchases are disabled by default',()=>{
 assert.match(source,/const BONUS_PURCHASES_READY = false;/);
 assert.match(source,/bonus_purchases_not_enabled/);
 assert.ok(source.indexOf('if(!BONUS_PURCHASES_READY)')<source.indexOf('qimem_buy_10etb_bonus_card('));
});

test('health check does not expose wallet or secrets',()=>{
 assert.match(source,/url\.pathname==='\/health'/);
 assert.match(source,/database:'not_checked'/);
 assert.match(source,/bonus_purchases_enabled:BONUS_PURCHASES_READY/);
});
