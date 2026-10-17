-- QIMEM BINGO / Neon registration bonus issuance
-- Backend-only SQL. Call ONLY after validating Telegram initData and creating
-- or finding qimem_players.id on the trusted server.
-- Execute in a single database transaction (one SQL statement).
-- A repeat request returns zero rows and never credits twice.
-- Bonus balance is NOT part of qimem_wallets.available_balance.
WITH new_bonus AS (
  INSERT INTO qimem_registration_bonus_accounts
    (player_id, granted_amount, available_amount)
  VALUES ($1::bigint, 10.00, 10.00)
  ON CONFLICT (player_id) DO NOTHING
  RETURNING player_id, granted_amount
)
INSERT INTO qimem_registration_bonus_transactions
  (player_id, amount, reason)
SELECT player_id, granted_amount, 'registration_grant'
FROM new_bonus
RETURNING player_id, amount, created_at;

-- Gameplay deductions must be a separate atomic operation.
-- Do not mark bonus as withdrawable or convert it into real cash.
-- A successful winning prize belongs in the separately audited real wallet ledger
-- only after the game engine has validated and finalized the winner.
