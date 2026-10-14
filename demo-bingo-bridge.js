/* QIMEM Bingo test-only backend bridge.
   Enabled only with ?demo=1. Default lobby behavior remains unchanged.
   Requires a deployed demo API and DEMO_ALLOWED_ORIGIN configured on the Worker.
   This does not authenticate Telegram users or enable payments. */
(()=>{
  if(new URLSearchParams(location.search).get("demo")!=="1")return;
  const API="https://kimem-bingo-backend.mickeyas2411.workers.dev";
  const KEY="qimemDemoPlayerId";
  const playerId=(()=>{
    let id=sessionStorage.getItem(KEY);
    if(!id){id="demo-"+crypto.randomUUID();sessionStorage.setItem(KEY,id)}
    return id;
  })();
  let startsAt=0, registered=[], busy=false, stopped=false, pollHandle=null;
  const notice=msg=>{if(typeof triggerToast==="function")triggerToast(msg);console.info("[QIMEM demo]",msg)};
  async function api(path,options){
    const res=await fetch(API+path,{...options,headers:{"content-type":"application/json",...(options?.headers||{})},cache:"no-store"});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||"demo_api_error");
    return data;
  }
  async function refresh(){
    const data=await api("/api/demo/games/current");
    startsAt=Date.parse(data.startsAt);
    if(!Number.isFinite(startsAt))throw new Error("invalid_server_start");
    return data;
  }
  const originalToggle=toggleCard;
  toggleCard=async function(id){
    if(busy||stopped)return;
    busy=true;
    const before=[...selectedCards];
    originalToggle(id);
    try{
      if(selectedCards.length){
        await api("/api/demo/games/join",{method:"POST",body:JSON.stringify({demoPlayerId:playerId,cardIds:[...selectedCards]})});
        registered=[...selectedCards];
      }else{
        // Empty selection cannot be registered by this demo API. Restore the previous reservation.
        selectedCards.splice(0,selectedCards.length,...before);
        updateUI();notice("Keep at least one card selected in demo mode.");
      }
    }catch(err){
      selectedCards.splice(0,selectedCards.length,...before);
      updateUI();
      notice("Card not reserved: "+err.message);
    }finally{busy=false}
  };
  enterLiveGame=function(){
    if(stopped||busy||!selectedCards.length||registered.join(",")!==selectedCards.join(",")){
      notice("Please reserve a card before entering live game.");return;
    }
    if(Date.now()<startsAt){notice("Waiting for the server countdown.");return}
    stopped=true;
    const ids=registered.slice(0,3);
    try{sessionStorage.setItem("kimemSelectedCards",JSON.stringify(ids));localStorage.setItem("kimemSelectedCards",JSON.stringify(ids))}catch{}
    location.href="./KIMEM_BINGO_20_Live_Game.html?cards="+encodeURIComponent(ids.join(","))+"&demo=1&gameId=DEMO-20";
  };
  startTimer=function(){
    if(timerHandle)clearInterval(timerHandle);
    const tick=()=>{
      if(stopped)return;
      const left=Math.max(0,Math.ceil((startsAt-Date.now())/1000));
      secondsRemaining=left;
      $("countdown").textContent=left+"s";
      if(left===5)kimemPlayCountdown();
      if(left>=1&&left<=5)showCountdownSecond(left);
      if(left===0){
        clearInterval(timerHandle);timerHandle=null;
        resetCountdownScene();
        if(registered.length)enterLiveGame();
        else notice("Round started. No reserved card.");
      }
    };
    refresh().then(()=>{
      tick();if(!stopped&&secondsRemaining>0)timerHandle=setInterval(tick,250);
      pollHandle=setInterval(()=>refresh().catch(()=>notice("Server sync unavailable")),5000);
    }).catch(err=>{$("countdown").textContent="OFFLINE";notice("Demo backend unavailable: "+err.message)});
  };
  window.addEventListener("pagehide",()=>{clearInterval(timerHandle);clearInterval(pollHandle)});
})();
