-- Inputs: $1 verified Telegram user ID (server-side verified initData), $2 username, $3 first name, $4 last name.
-- Requires migrations 001 and 002. Execute as one SQL statement/transaction.
-- Never trust an unverified Telegram ID from the browser.
WITH player AS (
 INSERT INTO qimem_players (telegram_id,username,first_name,last_name)
 VALUES ($1::bigint,$2::text,$3::text,$4::text)
 ON CONFLICT (telegram_id) DO UPDATE SET
  username=EXCLUDED.username,
  first_name=EXCLUDED.first_name,
  last_name=EXCLUDED.last_name,
  updated_at=now()
 RETURNING id
),
wallet AS (
 INSERT INTO qimem_wallets (player_id,available_balance,held_balance)
 SELECT id,0,0 FROM player
 ON CONFLICT (player_id) DO NOTHING
 RETURNING player_id
),
bonus AS (
 INSERT INTO qimem_registration_bonus_accounts(player_id,granted_amount,available_amount)
 SELECT id,10.00,10.00 FROM player
 ON CONFLICT (player_id) DO NOTHING
 RETURNING player_id,granted_amount
),
bonus_log AS (
 INSERT INTO qimem_registration_bonus_transactions(player_id,amount,reason)
 SELECT player_id,granted_amount,'registration_grant' FROM bonus
 RETURNING player_id
)
SELECT player.id AS player_id,
 EXISTS(SELECT 1 FROM bonus_log) AS bonus_newly_granted,
 (SELECT available_amount::text FROM qimem_registration_bonus_accounts WHERE player_id=player.id) AS bonus_balance_etb
FROM player;
