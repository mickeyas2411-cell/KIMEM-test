// Isolated offline regression of Bingo 10's real lock refresh function.
// No production requests, wallets, or database calls are made.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../KIMEM_BINGO_Game_Lobby.html",import.meta.url),"utf8");
const start=html.indexOf("function kimemOnRoundCardChange(");
const end=html.indexOf("function kimemRequestOwnedCards(",start);
assert.ok(start>0&&end>start,"Bingo 10 source block exists");
const actualSource=html.slice(start,end);
function deferred(){
 let resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b});
 return {promise,resolve,reject};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const requests=[],logs=[],counters={update:0,lockedOnly:0};
 const selectedCards=[],locks=new Set();
 const document={hidden:false};
 const context={
  document,selectedCards,activeCard:null,
  qimemOtherPlayerLocks:locks,qimemLockRound:null,qimemLocksReady:false,
  qimemLockLoading:false,qimemLockCheckedAt:0,qimemLockQueuedRound:null,
  qimemOwnedRound:null,qimemOwnedReady:false,qimemOwnedLastRequestedAt:0,
  qimemBingo10WalletOrigin:"https://mock-local.invalid",
  updateUI(){counters.update++},
  renderLockedCards(){counters.lockedOnly++},
  console:{warn(...args){logs.push(args)}},
  fetch(url){
   assert.match(url,/^https:\/\/mock-local\.invalid\/api\/v1\/public\/bingo10\/locked-cards\?round=/);
   const d=deferred();
   requests.push({url,...d});
   return d.promise;
  },
  Set,Number,Date,Promise
 };
 runInNewContext(actualSource,context);
 const response=(round,cards,{status=200,valid=true}={})=>({
  ok:status===200,status,
  async json(){return valid?{
   ok:true,source:"verified_paid_cards",roundCode:round,lockedCards:cards
  }:{ok:false}}
 });
 return {context,requests,logs,selectedCards,locks,document,counters,response};
}
test("forced selection update during in-flight snapshot is not dropped, stale result is skipped",async()=>{
 const f=fixture(),r="AA123456";
 f.context.kimemOnRoundCardChange(r);
 const first=f.context.kimemRefreshGlobalCardLocks(r);
 assert.equal(f.requests.length,1);
 const forced=f.context.kimemRefreshGlobalCardLocks(r,true);
 await forced;assert.equal(f.requests.length,1,"no duplicate concurrent fetch");
 f.requests[0].resolve(f.response(r,[1]));
 await first;await tick();
 assert.equal(f.requests.length,2,"one follow-up read queued");
 assert.equal(f.context.qimemLocksReady,false,"stale old snapshot not used");
 f.requests[1].resolve(f.response(r,[1,2]));
 await tick();
 assert.equal(f.context.qimemLocksReady,true);
 assert.deepEqual([...f.locks],[1,2]);
 assert.equal(f.counters.update,2,"one round reset and one fresh lock change");
});
test("repeated overlapping forced refreshes become one follow-up read",async()=>{
 const f=fixture(),r="AA123456";
 f.context.kimemOnRoundCardChange(r);
 const initial=f.context.kimemRefreshGlobalCardLocks(r);
 for(let i=0;i<80;i++)await f.context.kimemRefreshGlobalCardLocks(r,true);
 assert.equal(f.requests.length,1);
 f.requests[0].resolve(f.response(r,[2]));
 await initial;await tick();
 assert.equal(f.requests.length,2);
 f.requests[1].resolve(f.response(r,[2]));
 await tick();
 assert.equal(f.requests.length,2);
 assert.deepEqual([...f.locks],[2]);
});
test("normal 2-second polling does not queue extra backend reads on overlap",async()=>{
 const f=fixture(),r="AA123456";
 f.context.kimemOnRoundCardChange(r);
 const initial=f.context.kimemRefreshGlobalCardLocks(r);
 for(let i=0;i<20;i++)await f.context.kimemRefreshGlobalCardLocks(r);
 assert.equal(f.requests.length,1);
 f.requests[0].resolve(f.response(r,[10]));
 await initial;await tick();
 assert.equal(f.requests.length,1);
 assert.deepEqual([...f.locks],[10]);
});
test("new round must not receive previous round card locks; queued new round sync succeeds",async()=>{
 const f=fixture(),a="AA123456",b="AA123457";
 f.context.kimemOnRoundCardChange(a);
 const first=f.context.kimemRefreshGlobalCardLocks(a);
 f.context.kimemOnRoundCardChange(b);
 await f.context.kimemRefreshGlobalCardLocks(b);
 assert.equal(f.requests.length,1);
 f.requests[0].resolve(f.response(a,[1,2]));
 await first;await tick();
 assert.equal(f.requests.length,2,"new round queued behind previous round");
 assert.equal(f.context.qimemLockRound,b);
 assert.equal(f.locks.size,0,"old paid cards never leak into next round");
 f.requests[1].resolve(f.response(b,[50]));
 await tick();
 assert.deepEqual([...f.locks],[50]);
});
test("failed prior read still processes queued forced refresh and preserves last known state",async()=>{
 const f=fixture(),r="AA123456";
 f.context.kimemOnRoundCardChange(r);
 const initial=f.context.kimemRefreshGlobalCardLocks(r);
 await f.context.kimemRefreshGlobalCardLocks(r,true);
 f.requests[0].resolve(f.response(r,[],{status:503}));
 await initial;await tick();
 assert.equal(f.requests.length,2);
 f.requests[1].resolve(f.response(r,[48]));
 await tick();
 assert.deepEqual([...f.locks],[48]);
 assert.equal(f.context.qimemLocksReady,true);
});
test("hidden page never issues queued read; foreground force refresh uses same rules",async()=>{
 const f=fixture(),r="AA123456";
 f.context.kimemOnRoundCardChange(r);
 const initial=f.context.kimemRefreshGlobalCardLocks(r);
 f.context.kimemRefreshGlobalCardLocks(r,true);
 f.document.hidden=true;
 f.requests[0].resolve(f.response(r,[]));
 await initial;await tick();
 assert.equal(f.requests.length,1);
 f.document.hidden=false;
 const resumed=f.context.kimemRefreshGlobalCardLocks(r,true);
 assert.equal(f.requests.length,2);
 f.requests[1].resolve(f.response(r,[12]));
 await resumed;
 assert.deepEqual([...f.locks],[12]);
});
test("unchanged verified lock result does not cause unnecessary grid redraw",async()=>{
 const f=fixture(),r="AA123456";
 f.context.kimemOnRoundCardChange(r);
 let task=f.context.kimemRefreshGlobalCardLocks(r);
 f.requests[0].resolve(f.response(r,[1,5,7]));
 await task;
 const unchanged=f.counters.update;
 task=f.context.kimemRefreshGlobalCardLocks(r,true);
 f.requests[1].resolve(f.response(r,[1,5,7]));
 await task;
 assert.equal(f.counters.update,unchanged);
});
