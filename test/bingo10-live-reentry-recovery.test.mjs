// Isolated Bingo 10 live-game re-entry and Telegram identity recovery checks.
// This test performs NO real HTTP traffic and never changes wallet, cards, or Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../KIMEM_BINGO_Live_Game.html',import.meta.url),'utf8');
const lobby=readFileSync(new URL('../KIMEM_BINGO_Game_Lobby.html',import.meta.url),'utf8');
const sdk='<script src="https://telegram.org/js/telegram-web-app.js"></script>';
const liveCodeStart=html.indexOf('let activeRound=null,redirecting=false,finished=false,syncBusy=false,kimemFirstServerSync=true');
const liveCodeEnd=html.indexOf('let kimemLastDisplayedId=',liveCodeStart);
assert.ok(liveCodeStart>0&&liveCodeEnd>liveCodeStart,'Live paid card recovery exists');
const recoveryCode=html.slice(liveCodeStart,liveCodeEnd);
const ROUND='AA003548';
function createHarness(){
 const calls=[],selected=[],renders=[],warnings=[];
 const context={
   window:{Telegram:{WebApp:{initData:''}}},selected,manualMarks:{},
   fetch:async(url,options)=>{
     calls.push({url,options});
     throw Error('Unmocked request blocked');
   },cards(){renders.push([...context.selected])},console:{warn(...x){warnings.push(x)}},
   Set,Array,Number,String,Promise
 };
 runInNewContext(recoveryCode+'\nfunction __setRoundForTest(n){activeRound=n;}',context);
 return {
   context,calls,renders,warnings,
   read:()=>[...context.selected],
   restore:round=>context.kimemRestorePaidCards(round),
   setRound:n=>{context.__setRoundForTest(n)},
   setTelegramData:value=>{context.window.Telegram.WebApp.initData=value},
   mockReply:fn=>{context.fetch=async(url,options)=>{calls.push({url,options});return fn(url,options)}}
 };
}
const reply=(cards,roundCode=ROUND,ok=true)=>({
 ok:true, async json(){return {ok,roundCode,cards}}
});
test('live game loads the SAME official Telegram SDK as lobby before recovery scripts',()=>{
 assert.equal(lobby.includes(sdk),true,'approved lobby uses Telegram WebApp SDK');
 assert.equal((html.match(/telegram-web-app\.js/g)||[]).length,1,'live page imports exactly once');
 assert.ok(html.indexOf(sdk)>0);
 assert.ok(html.indexOf(sdk)<html.indexOf('function readCards()'),'SDK loads before live card setup');
 assert.ok(html.indexOf(sdk)<html.indexOf('kimemRestorePaidCards'),'SDK loads before recovery logic');
});
test('restores exactly the two paid cards for current live round after reopening Telegram mini app',async()=>{
 const h=createHarness();h.setRound(3548);h.setTelegramData('Telegram-signed-initdata-for-offline-test');
 h.mockReply((url,options)=>{
   assert.equal(url,'https://qimem-pay.mickeyas2411.workers.dev/api/v1/customer/bingo10/my-cards');
   assert.equal(options.method,'POST');
   assert.equal(JSON.parse(options.body).roundCode,ROUND);
   assert.equal(JSON.parse(options.body).initData,'Telegram-signed-initdata-for-offline-test');
   assert.equal(options.cache,'no-store');
   return reply([175,2298]);
 });
 await h.restore(ROUND);
 assert.deepEqual(h.read(),[175,2298]);
 assert.deepEqual(h.renders,[[175,2298]]);
 assert.equal(h.calls.length,1);
 await h.restore(ROUND);
 assert.equal(h.calls.length,1,'do not repeat after verified success');
});
test('starts with no Telegram session, retries when Telegram initData becomes available',async()=>{
 const h=createHarness();h.setRound(3548);
 await h.restore(ROUND);
 assert.equal(h.calls.length,0);
 h.setTelegramData('restored-Telegram-signed-initData');
 h.mockReply(()=>reply([301]));
 await h.restore(ROUND);
 assert.deepEqual(h.read(),[301]);
 assert.deepEqual(h.renders,[[301]]);
});
test('transient server error leaves current card unchanged and permits later retry',async()=>{
 const h=createHarness();h.setRound(3548);h.setTelegramData('signed');
 h.context.selected=[517];
 h.mockReply(()=>({ok:false,status:503}));
 await h.restore(ROUND);
 assert.deepEqual(h.read(),[517]);
 h.mockReply(()=>reply([517,633]));
 await h.restore(ROUND);
 assert.deepEqual(h.read(),[517,633]);
 assert.deepEqual(h.renders,[[517,633]]);
});
test('rejects invalid or stale round data without leaking cards into a different round',async()=>{
 const h=createHarness();h.setRound(3549);h.setTelegramData('signed');
 h.mockReply(()=>reply([432],ROUND));
 await h.restore(ROUND);
 assert.deepEqual(h.read(),[]);
 h.setRound(3548);
 h.mockReply(()=>reply([432],ROUND));
 await h.restore(ROUND);
 assert.deepEqual(h.read(),[432]);
});
test('verified empty cards stay empty and never synthesize purchases',async()=>{
 const h=createHarness();h.setRound(3548);h.setTelegramData('signed');
 h.mockReply(()=>reply([]));
 await h.restore(ROUND);
 assert.deepEqual(h.read(),[]);
 assert.equal(h.calls.length,1);
});
test('no backend, payout, design, countdown or card-generation logic changed by this fix',()=>{
 assert.ok(html.includes('function readCards()'));
 assert.ok(html.includes('function cardFor(id)'));
 assert.ok(html.includes('function kimemWinningCards('));
 assert.ok(html.includes('function updateDraw(n)'));
 assert.ok(html.includes('function kimemRestorePaidCards(roundCode)'));
 assert.ok(html.includes("if(r.phase==='live'||r.phase==='finished')kimemRestorePaidCards(r.gameId);"));
});
