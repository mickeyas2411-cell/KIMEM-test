/** Staging-only composition: preserve verified login routes while adding player API. */
import loginGateway from './staging-auth-gateway.js';
import playerApi from './player-api-worker.js';

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    // Preserve existing login-test, diagnostics and health behavior unchanged.
    if (path === '/login-test' || path === '/diagnostics/auth' || path === '/health') {
      return loginGateway.fetch(request, env, ctx);
    }
    if (path === '/api/me/register' || path === '/api/me/bonus-balance' ||
        path === '/api/me/balances' || path === '/api/cards/buy-bonus') {
      return playerApi.fetch(request, env, ctx);
    }
    return loginGateway.fetch(request, env, ctx);
  }
};
