import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const cases=[
 ['KIMEM_BINGO_Game_Lobby.html',10],
 ['KIMEM_BINGO_Live_Game.html',10],
 ['KIMEM_BINGO_20_Lobby.html',20],
 ['KIMEM_BINGO_20_Live_Game.html',20]
];
for(const [name,stake] of cases){
 test(name+' presents read-only saved settings without changing live prize values',()=>{
  const src=readFileSync(new URL('../'+name,import.meta.url),'utf8');
  const marker='/* Read-only presentation of independently saved Master Admin values';
  assert.equal(src.split(marker).length,2);
  const addon=src.slice(src.indexOf(marker));
  assert.ok(addon.includes('const stake='+stake+','));
  assert.ok(addon.includes('/api/v1/public/bingo-settings?stake='));
  assert.ok(addon.includes('data.appliedToGame!==false'));
  assert.ok(addon.includes("cache:'no-store'"));
  assert.ok(addon.includes("setInterval(refresh,30000)"));
  assert.ok(!addon.includes('wallet.credit'));
  assert.ok(!addon.includes('settleRound('));
 });
}
