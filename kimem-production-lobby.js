/* Production lobby network bridge. Requires Telegram Mini App verified initData. */
window.KimemProductionLobby={
 base:"https://kimem-bingo-backend.mickeyas2411.workers.dev",
 stake(){
  const q=new URLSearchParams(location.search),stake=Number(q.get("stake")||20);
  if(stake!==10&&stake!==20)throw Error("Invalid Bingo stake");
  return stake;
 },
 async request(action,cardIds){
  const initData=window.Telegram?.WebApp?.initData;
  if(!initData)throw Error("Open this game from the Telegram Mini App");
  const stake=this.stake();
  const res=await fetch(this.base+"/api/v1/bingo/"+stake+"/"+action,{
   method:action==="join"?"POST":"GET",
   headers:{"X-Telegram-Init-Data":initData,...(action==="join"?{"Content-Type":"application/json"}:{})},
   ...(action==="join"?{body:JSON.stringify({cardIds})}:{})
  });
  const result=await res.json();
  if(!res.ok)throw Error(result.error==="card_reserved"?"Card #"+result.cardId+" is already reserved":result.error||"Server unavailable");
  return result;
 },
 current(){return this.request("current")},
 join(cards){return this.request("join",cards)}
};
