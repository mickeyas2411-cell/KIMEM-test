/* QIMEM BINGO authenticated balance display adapter.
 * Feature branch only. Do not deploy without a verified backend.
 * The backend must validate Telegram initData and return authoritative values.
 */
(function(global){
  'use strict';
  const format = (value) => {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.\d{2}$/.test(value)) return null;
    const amount = Number(value);
    return Number.isSafeInteger(Math.round(amount * 100)) && amount >= 0 ? amount.toFixed(2) : null;
  };
  async function refreshBalances(options) {
    const opts = options || {};
    const endpoint = opts.endpoint || '/api/me/balances';
    const tg = global.Telegram && global.Telegram.WebApp;
    const realEl = global.document.getElementById('lobby-balance');
    const bonusEl = global.document.getElementById('lobby-bonus-balance');
    if (realEl) realEl.textContent = '—';
    if (bonusEl) bonusEl.textContent = '—';
    if (!tg || !tg.initData) return {ok:false,reason:'telegram_auth_unavailable'};
    try {
      const response = await global.fetch(endpoint,{
        method:'GET',cache:'no-store',credentials:'omit',
        headers:{'Authorization':'tma '+tg.initData,'Accept':'application/json'}
      });
      if (!response.ok) throw new Error('balance_service_unavailable');
      const data = await response.json();
      if (!data || data.ok !== true || !data.balances) throw new Error('invalid_response');
      const real = format(data.balances.real_etb);
      const bonus = format(data.balances.bonus_etb);
      if (real === null || bonus === null) throw new Error('invalid_balance');
      if (realEl) realEl.textContent = real;
      if (bonusEl) bonusEl.textContent = bonus;
      return {ok:true};
    } catch (_) {
      return {ok:false,reason:'balance_unavailable'};
    }
  }
  global.kimemRefreshVerifiedBalances = refreshBalances;
})(window);
