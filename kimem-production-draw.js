/* Read-only bridge for the authoritative Bingo draw.
 * Requires a Telegram Mini App session. Never generates replacement draw numbers.
 */
window.KimemProductionDraw={
 base:"https://kimem-bingo-backend.mickeyas2411.workers.dev",
 stake(){
  const stake=Number(new URLSearchParams(location.search).get("stake"));
  if(stake!==10&&stake!==20)throw Error("Invalid Bingo stake");
  return stake;
 },
 async snapshot(){
  const initData=window.Telegram?.WebApp?.initData;
  if(!initData)throw Error("Open this game inside Telegram");
  const response=await fetch(this.base+"/api/v1/bingo/"+this.stake()+"/draw",{
   headers:{"X-Telegram-Init-Data":initData},cache:"no-store"
  });
  if(!response.ok)throw Error("Draw server unavailable ("+response.status+")");
  const data=await response.json();
  if(data.stakeETB!==this.stake()||!Array.isArray(data.drawnNumbers)||
   data.drawnNumbers.length>75||new Set(data.drawnNumbers).size!==data.drawnNumbers.length||
   !data.drawnNumbers.every(n=>Number.isInteger(n)&&n>=1&&n<=75))throw Error("Invalid server draw");
  const requestedGame=new URLSearchParams(location.search).get("gameId");
  if(requestedGame&&data.gameId!==requestedGame)throw Error("Game ID mismatch");
  return data;
 }
};
