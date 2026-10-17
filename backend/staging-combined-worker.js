/** Staging-only composition: preserve verified login routes while adding player API. */
import loginGateway from './staging-auth-gateway.js';
import playerApi from './player-api-worker.js';

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    // Preserve the verified Telegram login and signature diagnostics unchanged.
    // The combined health response is a deployment marker, not a DB connectivity test.
    if (path === '/health' && request.method === 'GET') {
      const response = await loginGateway.fetch(request, env, ctx);
      const health = await response.json();
      return new Response(JSON.stringify({
        ...health,
        mode: 'combined-staging',
        database: env.STAGING_DATABASE_URL ? 'secret_configured_connection_unverified' : 'secret_missing',
        bonus_purchases_enabled: false
      }), { status: response.status, headers: response.headers });
    }
    if (path === '/health/database' && request.method === 'GET') {
      return playerApi.fetch(request, env, ctx);
    }
    if (path === '/registration-test' && request.method === 'GET') {
      return new Response("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>KIMEM Registration Staging Test</title><script src=\"https://telegram.org/js/telegram-web-app.js\"></script><style>body{background:#101827;color:#f8fafc;font:16px system-ui;margin:0;padding:22px}main{max-width:440px;margin:9vh auto;padding:24px;background:#172338;border:1px solid #334155;border-radius:18px}h1{font-size:23px}p{color:#cbd5e1;line-height:1.6}button{background:#22c55e;color:#052e16;border:0;border-radius:10px;padding:14px 18px;font-weight:700}button:disabled{opacity:.5}output{display:block;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:20px}</style></head><body><main><h1>KIMEM · Registration Test</h1><p>Staging only. Register your Telegram account and check the one-time 10 ETB welcome bonus. No card purchases or real-money transactions.</p><button id=\"register\">Register and check bonus</button><output id=\"result\" role=\"status\">Open inside @Kimemtest_bot Mini App.</output></main><script>const b=document.getElementById('register'),o=document.getElementById('result');b.addEventListener('click',async()=>{const d=window.Telegram?.WebApp?.initData;if(!d){o.textContent='Open this page inside the Telegram Mini App.';return}b.disabled=true;o.textContent='Verifying and registering…';try{const headers={Authorization:'tma '+d};const r=await fetch('/api/me/register',{method:'POST',headers,cache:'no-store'});const x=await r.json();if(!r.ok||!x.ok){o.textContent='Registration failed: '+String(x.error||r.status);return}const bal=await fetch('/api/me/bonus-balance',{headers,cache:'no-store'});const y=await bal.json();o.textContent=bal.ok&&y.ok?'Registration verified. Welcome bonus: '+String(y.bonus_etb)+' ETB. '+(x.bonus_newly_granted?'First-time grant.':'Existing bonus account.'):'Registered; balance check failed: '+String(y.error||bal.status)}catch{o.textContent='Network error. Try again.'}finally{b.disabled=false}});window.Telegram?.WebApp?.ready();</script></body></html>", {headers: {'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
    }
    if (path === '/login-test' || path === '/diagnostics/auth') {
      return loginGateway.fetch(request, env, ctx);
    }
    if (path === '/api/me/register' || path === '/api/me/bonus-balance' ||
        path === '/api/me/balances' || path === '/api/cards/buy-bonus') {
      return playerApi.fetch(request, env, ctx);
    }
    return loginGateway.fetch(request, env, ctx);
  }
};
