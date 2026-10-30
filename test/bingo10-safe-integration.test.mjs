import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

function text(path){return fs.readFileSync(path,'utf8')}
function inlineScripts(html){return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim())}
test('Bingo 10 Live and Lobby JavaScript parses cleanly',()=>{
 for(const file of ['KIMEM_BINGO_Game_Lobby.html','KIMEM_BINGO_Live_Game.html']){
  const scripts=inlineScripts(text(file));
  assert.ok(scripts.length>0);
  for(const source of scripts)assert.doesNotThrow(()=>new vm.Script(source,{filename:file}));
 }
});
test('Bingo 20 Lobby and Live remain byte-for-byte identical to production main',()=>{
 for(const file of ['KIMEM_BINGO_20_Lobby.html','KIMEM_BINGO_20_Live_Game.html']){
  const production=execFileSync('git',['show','origin/main:'+file],{encoding:'utf8'});
  assert.equal(text(file),production);
 }
});
test('Bingo 10 retains card recovery, ownership locks, server cap, wrong-Bingo sound',()=>{
 const lobby=text('KIMEM_BINGO_Game_Lobby.html');
 const game=text('KIMEM_BINGO_Live_Game.html');
 for(const name of ['kimemCardCapacity','kimemRecoverPaidCards','kimemTakenCards','kimem-card-limit','i<=kimemCardCapacity'])
  assert.ok(lobby.includes(name),name);
 assert.ok(game.includes('kimemBingoWrongSound'));
 assert.ok(game.includes("kimemSmallNotice('NO BINGO YET')"));
 assert.ok(game.includes('n<=3000'));
 assert.ok(game.includes('event.stopImmediatePropagation()'));
});

test('Bingo 10 Lobby, Live Game and 3000-card generation agree on all card numbers',()=>{
 const lobby=text('KIMEM_BINGO_Game_Lobby.html');
 const live=text('KIMEM_BINGO_Live_Game.html');
 const extract=(source,name)=>{
  const marker='function '+name+'(id){';
  const start=source.indexOf(marker);
  assert.ok(start>=0,name+' function exists');
  const end=source.indexOf('\\n',start);
  assert.ok(end>start,name+' stays self-contained');
  return vm.runInNewContext('('+source.slice(start,end)+')');
 };
 const preview=extract(lobby,'generateDeterministicCard');
 const play=extract(live,'cardFor');
 for(const id of [1,27,999,1000,1001,1500,2000,2500,2999,3000]){
  const p=preview(id).map(row=>Array.from(row,n=>n==='FREE'?0:n));
  const g=play(id);
  assert.deepEqual(p,JSON.parse(JSON.stringify(g)),'Card #'+id+' must not change from Lobby to Live');
  assert.equal(new Set(g.flat().filter(Boolean)).size,24);
 }
});
