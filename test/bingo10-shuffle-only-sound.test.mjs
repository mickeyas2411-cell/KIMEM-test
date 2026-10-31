// Scoped Bingo 10 shuffle-only audio regression checks. No network and no paid API.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const html=readFileSync(new URL('../KIMEM_BINGO_Live_Game.html',import.meta.url),'utf8');
const library='kimem-shuffle-selected-2.mp3';
const sdkTest=readFileSync(new URL('../test/bingo10-live-reentry-recovery.test.mjs',import.meta.url),'utf8');
test('selected soundtrack uses exactly one dedicated local asset, not ball voice or prize audio',()=>{
 assert.match(html,/const kimemShuffleAudio=new Audio\(new URL\('\.\/kimem-shuffle-selected-2\.mp3',location\.href\)\.href\)/);
 assert.match(html,/KIMEM_VOICE_ENDPOINT\+n\+'\.mp3'/);
 assert.match(html,/kimem-bingo-win\.mp3/);
 assert.match(html,/kimem-bingo-wrong\.wav/);
 assert.match(html,/kimemResultCountdownAudio/);
});
test('authoritative fresh live round and first shuffle phase only; never replay on returning to existing draw',()=>{
 assert.match(html,/round\.phase!=='live'/);
 assert.match(html,/round\.drawn\.length/);
 assert.match(html,/kimemShuffleAudioStarted=true/);
 assert.match(html,/spherePhase!=='shuffle'/);
 assert.match(html,/kimemStartShuffleAudioIfVerified\(r\)/);
});
test('one-time 4s shuffle ends on completion, server interruption, or winner finish',()=>{
 assert.match(html,/kimemStopShuffleAudio\(\);\$\('machine'\)\.classList\.remove\('kimem-shuffling'\)/);
 assert.match(html,/if\(kimemFirstServerSync&&pending\.length>0&&spherePhase==='shuffle'\)\{\s*kimemStopShuffleAudio\(\)/);
 assert.match(html,/kimemFinished=true;window\.kimemBingoEnding=true;running=false;kimemStopShuffleAudio\(\)/);
 assert.match(html,/if\(elapsed<0\|\|elapsed>=3\.9\)return/);
 assert.match(html,/kimemShuffleAudio\.volume=\.72/);
});
test('existing Telegram paid-card recovery and 3k-card UX remain',()=>{
 assert.ok(sdkTest.includes('restores exactly the two paid cards'));
 assert.match(html,/function kimemRestorePaidCards\(roundCode\)/);
 assert.match(html,/function cardFor\(id\)/);
 assert.match(html,/function updateDraw\(n\)/);
});
test('selected soundtrack file exists in same directory for production deployment',()=>{
 assert.ok(existsSync(new URL('../'+library,import.meta.url)),'Required shuffle soundtrack MP3 is missing: do not deploy');
});
