/* KIMEM: isolated, server-verified Telegram player registration. */
(() => {
  'use strict';
  const telegram = window.Telegram?.WebApp;
  const endpoint = 'https://kimem-test-backend.mickeyas2411.workers.dev/api/player/register';
  let account = null;
  let registrationStatus = 'Checking secure account registration…';

  const updateGameCredit = () => {
    const credit = document.querySelector('.bl-credit-left b');
    if (!credit) return;
    if (!account) {
      credit.textContent = '— ETB';
      return;
    }
    const balance = Number(account.wallet.availableBalance);
    credit.textContent = Number.isFinite(balance) && balance >= 0
      ? balance.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' ETB'
      : '— ETB';
  };

  const updateWallet = () => {
    const panel = document.getElementById('kimemAccountPanel');
    if (!panel?.classList.contains('visible')) return;
    if (panel.querySelector('h3')?.textContent.trim() !== 'Wallet') return;
    const description = panel.querySelector('p');
    const status = panel.querySelector('.account-status');
    if (account) {
      if (description) description.textContent = 'Available balance: ' + account.wallet.availableBalance + ' ETB';
      if (status) status.textContent = 'Verified Telegram account. Payments and purchases are not enabled.';
    } else if (status) {
      status.textContent = registrationStatus + ' Payments and purchases are not enabled.';
    }
  };

  const start = async () => {
    const panel = document.getElementById('kimemAccountPanel');
    if (panel) new MutationObserver(updateWallet).observe(panel, {childList: true});
    if (!telegram?.initData) {
      registrationStatus = 'Registration check: Telegram authentication data unavailable. Open from the bot menu.';
      updateWallet();
      return;
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({initData: telegram.initData}),
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const safeErrors = ['invalid_telegram_auth', 'telegram_auth_expired', 'telegram_signature_mismatch', 'invalid_init_data', 'server_not_configured', 'registration_unavailable', 'origin_not_allowed', 'request_too_large'];
        const code = safeErrors.includes(data.error) ? data.error : (typeof data.error === 'string' && /^[a-z_]{3,60}$/.test(data.error) ? data.error : 'http_' + response.status + '_' + (response.headers.get('content-type')?.includes('application/json') ? 'unknown_json' : 'non_json'));
        registrationStatus = 'Registration check: ' + code + '.';
        updateWallet();
        return;
      }
      if (!data.ok || !data.player || !data.wallet) {
        registrationStatus = 'Registration check: unexpected_server_response.';
        updateWallet();
        return;
      }
      account = data;
      updateGameCredit();
      updateWallet();
      window.dispatchEvent(new CustomEvent('kimem:player-ready', {detail: {playerId: data.player.id}}));
    } catch {
      registrationStatus = 'Registration check: network_or_connection_error.';
      updateWallet();
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
