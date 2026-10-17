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
