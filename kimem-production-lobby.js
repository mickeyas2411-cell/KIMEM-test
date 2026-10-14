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
  let res;
  try{res=await fetch(this.base+"/api/v1/bingo/"+stake+"/"+action,{
   method:action==="join"?"POST":"GET",
   headers:{"X-Telegram-Init-Data":initData,...(action==="join"?{"Content-Type":"application/json"}:{})},
   ...(action==="join"?{body:JSON.stringify({cardIds})}:{})
  })}catch{throw Error("Connection unavailable. Please try again.")}
  const result=await res.json().catch(()=>({error:"invalid_server_response"}));
  if(!res.ok){
   const messages={
    shared_wallet_join_requires_reconciliation:"Demo wallet card selection is temporarily unavailable while the shared balance is being secured.",
    shared_wallet_not_configured:"Demo wallet is temporarily unavailable.",
    insufficient_demo_balance:"Not enough demo balance for these cards.",
    registration_closed:"Card selection is closed for this round.",
    selection_conflict:"Card selection changed. Refresh and try again.",
    invalid_server_response:"Server returned an invalid response. Please retry."
   };
   throw Error(result.error==="card_reserved"?"Card #"+result.cardId+" is already reserved":messages[result.error]||result.error||"Server unavailable");
  }
  return result;
 },
 current(){return this.request("current")},
 wallet(){return this.request("wallet")},
 walletHistory(){return this.request("wallet-history")},
 join(cards){return this.request("join",cards)}
};
