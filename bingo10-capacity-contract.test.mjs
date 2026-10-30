import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../KIMEM_BINGO_Game_Lobby.html",import.meta.url),"utf8");
test("Bingo 10 grid follows authoritative round limit",()=>{
 for(const marker of ["kimemCapacityFromRound(r)","i<=kimemRoundCardCapacity","target<=kimemRoundCardCapacity","id>kimemRoundCardCapacity"])assert.ok(html.includes(marker),marker);
});
test("Legacy rounds retain 3000 and other UI remains available",()=>{
 assert.ok(html.includes("kimemRoundCardCapacity=3000"));
 for(const marker of ["qimem-bingo10-card-change","kimemVerifiedLobbyBalance","KIMEM_BINGO_Live_Game.html"])assert.ok(html.includes(marker),marker);
});
