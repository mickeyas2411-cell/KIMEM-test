// Bingo 10: only Telegram fullscreen header layout safeguard.
// Offline code contracts; never make requests to Telegram, wallets, or live services.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const live=readFileSync(new URL("../KIMEM_BINGO_Live_Game.html",import.meta.url),"utf8");
const lobby=readFileSync(new URL("../KIMEM_BINGO_Game_Lobby.html",import.meta.url),"utf8");

function cssFingerprint(html){
 const styles=[...html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map(x=>x[1]);
 const css=styles.join("\n");
 let hash=2166136261;
 for(let i=0;i<css.length;i++)hash=Math.imul(hash^css.charCodeAt(i),16777619)>>>0;
 return {count:styles.length,hash:hash.toString(16)};
}
test("Live and lobby all existing CSS stay byte-for-byte unchanged",()=>{
 assert.deepEqual(cssFingerprint(live),{count:37,hash:"cdb03e03"});
 assert.deepEqual(cssFingerprint(lobby),{count:1,hash:"3f50aa86"});
});
test("Live page no longer enters transparent fullscreen over Telegram Close button",()=>{
 assert.ok(!live.includes("tg.requestFullscreen()"));
 assert.match(live,/if\(tg\?\.isFullscreen&&typeof tg\.exitFullscreen==='function'\)tg\.exitFullscreen\(\)/);
 assert.ok(live.includes("tg?.ready();tg?.expand()"));
 assert.ok(live.includes("tg?.onEvent('fullscreenChanged',sync)"));
 assert.ok(live.includes("tg?.onEvent('viewportChanged',sync)"));
});
test("Live page keeps Telegram expand but exits fullscreen only when native fullscreen was active",()=>{
 const snippet=live.match(/try\{const tg=window\.Telegram\?\.WebApp;tg\?\.ready\(\);tg\?\.expand\(\);if\(tg\?\.isFullscreen&&typeof tg\.exitFullscreen==='function'\)tg\.exitFullscreen\(\)\}catch\(e\)\{\}/)?.[0];
 assert.ok(snippet,"exact native header init must remain isolated");
 for(const initial of [false,true]){
  const calls=[];
  const tg={isFullscreen:initial,ready(){calls.push("ready")},expand(){calls.push("expand")},exitFullscreen(){calls.push("exitFullscreen")}};
  runInNewContext(snippet,{window:{Telegram:{WebApp:tg}}});
  assert.deepEqual(calls,initial?["ready","expand","exitFullscreen"]:["ready","expand"]);
 }
});
test("Lobby preserves native header and can exit a fullscreen state carried over from Live",()=>{
 const begin=lobby.indexOf("function init(){");
 const first=lobby.indexOf("try{if(tg){",begin);
 const end=lobby.indexOf("}}catch(e){}",first);
 assert.ok(begin>0&&first>begin&&end>first);
 const snippet=lobby.slice(first,end+"}}catch(e){}".length);
 for(const initial of [false,true]){
  const calls=[],events=[];
  const tg={isFullscreen:initial,ready(){calls.push("ready")},expand(){calls.push("expand")},onEvent(e){events.push(e)},exitFullscreen(){calls.push("exitFullscreen")}};
  runInNewContext(snippet,{tg,syncTelegramViewport:()=>{}});
  assert.deepEqual(calls,initial?["ready","expand","exitFullscreen"]:["ready","expand"]);
  assert.deepEqual(events,["viewportChanged","safeAreaChanged","contentSafeAreaChanged","fullscreenChanged"]);
 }
});
test("Do not disturb the working shuffle audio, spoken balls, paid-card recovery, winner logic or gameplay",()=>{
 assert.match(live,/kimem-shuffle-selected-2\.ogg/);
 assert.match(live,/const kimemShuffleAudio=new Audio/);
 assert.match(live,/if\(pending\.length\)kimemStopShuffleAudio\(\)/);
 assert.match(live,/const kimemVoiceQueue=\[\]/);
 assert.match(live,/function kimemRestorePaidCards\(roundCode\)/);
 assert.match(live,/function kimemFinishGame\(/);
 assert.match(lobby,/function renderCardGrid\(\)/);
 assert.match(lobby,/function kimemRefreshGlobalCardLocks\(/);
});
