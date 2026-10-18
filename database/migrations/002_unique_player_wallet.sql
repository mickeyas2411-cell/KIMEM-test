-- Migration 002: enforce one player per Telegram identity and one wallet per player.
-- Apply only after duplicate detection and review; never apply blindly to production.
-- Duplicate detection:
-- SELECT telegram_id, count(*) FROM qimem_players GROUP BY telegram_id HAVING count(*) > 1;
-- SELECT player_id, count(*) FROM qimem_wallets GROUP BY player_id HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS qimem_players_telegram_id_unique ON qimem_players (telegram_id);
CREATE UNIQUE INDEX IF NOT EXISTS qimem_wallets_player_id_unique ON qimem_wallets (player_id);
