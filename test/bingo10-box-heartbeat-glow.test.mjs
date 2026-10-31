import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const fx=readFileSync(new URL('../qimem-bingo10-reward-fx.js',import.meta.url),'utf8');
const lobby=readFileSync(new URL('../KIMEM_BINGO_Game_Lobby.html',import.meta.url),'utf8');
const live=readFileSync(new URL('../KIMEM_BINGO_Live_Game.html',import.meta.url),'utf8');
test('only the existing three reward boxes gain heartbeat and glow, no new card overlay',()=>{
 assert.match(fx,/const row=root\?\.querySelector\('\.bonus-row'\)/);
 assert.match(fx,/const buttons=\[\.\.\.row\.children\]/);
 assert.match(fx,/buttons\.length!==3/);
 assert.match(fx,/transform:scale\(1\.018\)/);
 assert.match(fx,/box-shadow:0 0 16px 3px/);
 assert.match(fx,/button\.classList\.toggle\('q-reward-heartbeat',!!speed\)/);
});
test('time-based daily or weekly beating activates only within 10 minutes of configured scheduled draw',()=>{
 assert.ok(fx.includes("if(diff>=0&&diff<=10)speed=diff<=0?'.25s':diff<=1?'.36s':'.95s';"));
 assert.match(fx,/k!=='weekly'\|\|Number\(r\.weeklyDay\)===t\.day/);
});
test('jackpot threshold heartbeat, verified server-only event and full accumulated award remain unchanged',()=>{
 assert.ok(fx.includes("if(balance>=min)speed='.52s';else if(balance>=min*.75)speed='.78s';else if(balance>=min*.5)speed='1.1s';"));
 assert.match(fx,/data\?\.funds\?\.source!=='verified_paid_rounds_after_cutover'/);
 assert.match(fx,/if\(loaded\)\{for\(const e of events\.slice\(\)\.reverse\(\)\)if\(!seen\.has\(e\.id\)\)celebrate\(e\);\}/);
 assert.match(fx,/const amount=Number\(ev\.prizeBirr\)/);
});
test('existing Lobby and Live screens still link only the same shared reward FX module',()=>{
 assert.match(lobby,/<script src="\.\/qimem-bingo10-reward-fx\.js" defer><\/script>/);
 assert.match(live,/<script src="\.\/qimem-bingo10-reward-fx\.js" defer><\/script>/);
});
