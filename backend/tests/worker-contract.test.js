import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../player-api-worker.js',import.meta.url),'utf8');
test('Telegram verification precedes purchases',()=>{
 const verify=source.indexOf('verifyTelegram(auth.slice(4)');
 const purchase=source.indexOf("if(url.pathname==='/api/cards/buy-bonus')");
 assert.ok(verify>=0 && purchase>=0 && verify<purchase);
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
 const guard=source.indexOf('if(!BONUS_PURCHASES_READY)');
 const debit=source.indexOf('qimem_buy_10etb_bonus_card(');
 assert.ok(guard>=0 && debit>=0 && guard<debit);
});

test('health check does not expose wallet or secrets',()=>{
 assert.match(source,/url\.pathname==='\/health'/);
 assert.match(source,/database:'not_checked'/);
 assert.match(source,/bonus_purchases_enabled:BONUS_PURCHASES_READY/);
});

test('registration grant uses one-time bonus ledger and exposes new amount in CTE',()=>{
 assert.match(source,/ON CONFLICT\(telegram_id\) DO UPDATE/);
 assert.match(source,/ON CONFLICT\(player_id\) DO NOTHING/);
 assert.match(source,/RETURNING player_id,granted_amount,available_amount/);
 assert.match(source,/SELECT player\.id,EXISTS\(SELECT 1 FROM bonus_log\) AS bonus_newly_granted/);
});
test('unverified requests cannot reach the database',()=>{
 const auth=source.indexOf('if(!user) return json');
 const database=source.indexOf('const sql=neon(env.STAGING_DATABASE_URL)');
 assert.ok(auth>=0 && database>=0 && auth<database);
});

const combined=readFileSync(new URL('../staging-combined-worker.js',import.meta.url),'utf8');
const loginGateway=readFileSync(new URL('../staging-auth-gateway.js',import.meta.url),'utf8');
test('combined worker preserves login and diagnostics routes',()=>{
 assert.match(combined,/path === '\/login-test'/);
 assert.match(combined,/path === '\/diagnostics\/auth'/);
 assert.match(combined,/return loginGateway\.fetch\(request, env, ctx\)/);
});
test('combined worker routes player endpoints to API',()=>{
 for(const path of ['/api/me/register','/api/me/bonus-balance','/api/me/balances','/api/cards/buy-bonus'])
  assert.ok(combined.includes(path));
 assert.match(combined,/return playerApi\.fetch\(request, env, ctx\)/);
});
test('login test uses independent signature diagnostic, not bonus state',()=>{
 assert.match(loginGateway,/fetch\('\/diagnostics\/auth'/);
 const login=loginGateway.split('const loginPage=')[1].split('const hex=')[0];
 assert.doesNotMatch(login,/fetch\('\/api\/me\/bonus-balance'/);
});

test('combined staging health identifies deployed bundle without claiming database connectivity',()=>{
 assert.match(combined,/mode: 'combined-staging'/);
 assert.match(combined,/secret_configured_connection_unverified/);
 assert.match(combined,/bonus_purchases_enabled: false/);
});

test('staging health does not claim database connectivity or enable purchases',()=>{
 assert.match(combined,/path === '\/health' && request.method === 'GET'/);
 assert.match(combined,/mode: 'combined-staging'/);
 assert.match(combined,/database: env\.STAGING_DATABASE_URL \? 'secret_configured_connection_unverified' : 'secret_missing'/);
 assert.match(combined,/bonus_purchases_enabled: false/);
});
test('staging login and auth diagnostic bypass the player API',()=>{
 const loginStart=combined.indexOf("if (path === '/login-test' || path === '/diagnostics/auth')");
 const apiStart=combined.indexOf("if (path === '/api/me/register'");
 assert.ok(loginStart>=0 && apiStart>loginStart);
 const loginBlock=combined.slice(loginStart,apiStart);
 assert.match(loginBlock,/return loginGateway\.fetch\(request, env, ctx\)/);
 assert.doesNotMatch(loginBlock,/playerApi\.fetch/);
});
