/* KIMEM: isolated, server-verified Telegram player registration. */
(() => {
  'use strict';
  const telegram = window.Telegram?.WebApp;
  if (!telegram?.initData) return;
  let account = null;
  const endpoint = 'https://kimem-test-backend.mickeyas2411.workers.dev/api/player/register';
  const updateWallet = () => {
    const panel = document.getElementById('kimemAccountPanel');
    if (!account || !panel?.classList.contains('visible')) return;
    if (panel.querySelector('h3')?.textContent.trim() !== 'Wallet') return;
    const description = panel.querySelector('p');
    const status = panel.querySelector('.account-status');
    if (description) description.textContent = 'Available balance: ' + account.wallet.availableBalance + ' ETB';
    if (status) status.textContent = 'Verified Telegram account. Payments and purchases are not enabled.';
  };
  const start = async () => {
    const panel = document.getElementById('kimemAccountPanel');
    if (panel) new MutationObserver(updateWallet).observe(panel, {childList: true});
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({initData: telegram.initData}),
        cache: 'no-store'
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!data.ok || !data.player || !data.wallet) return;
      account = data;
      updateWallet();
      window.dispatchEvent(new CustomEvent('kimem:player-ready', {detail: {playerId: data.player.id}}));
    } catch {
      console.warn('Verified player registration unavailable');
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
