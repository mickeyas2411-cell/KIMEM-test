-- Repeatable read-only preflight before enabling purchases in a new environment.
-- Any nonzero duplicate count blocks migration 003.
SELECT 'duplicate_telegram_ids' AS check_name, COUNT(*)::bigint AS issues
FROM (SELECT telegram_id FROM qimem_players GROUP BY telegram_id HAVING COUNT(*)>1) t
UNION ALL
SELECT 'duplicate_wallets', COUNT(*)::bigint
FROM (SELECT player_id FROM qimem_wallets GROUP BY player_id HAVING COUNT(*)>1) t
UNION ALL
SELECT 'duplicate_round_cards', COUNT(*)::bigint
FROM (SELECT round_id,card_number FROM qimem_round_cards
      GROUP BY round_id,card_number HAVING COUNT(*)>1) t
UNION ALL
SELECT 'orphaned_bonus_accounts', COUNT(*)::bigint
FROM qimem_registration_bonus_accounts a
LEFT JOIN qimem_players p ON p.id=a.player_id WHERE p.id IS NULL
UNION ALL
SELECT 'negative_bonus_balances', COUNT(*)::bigint
FROM qimem_registration_bonus_accounts WHERE available_amount<0;
