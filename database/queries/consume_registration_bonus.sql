-- QIMEM BINGO: consume registration bonus for a 10 ETB bingo stake.
-- Execute on the backend after Telegram auth, round state, room and card
-- availability have been checked. $1=player_id, $2=round_id.
-- The round/card reservation and bonus debit MUST ultimately be in the same
-- atomic transaction. This standalone query is not a complete purchase API.
WITH debited AS (
  UPDATE qimem_registration_bonus_accounts
  SET available_amount = available_amount - 10.00
  WHERE player_id = $1::bigint AND available_amount >= 10.00
  RETURNING player_id
)
INSERT INTO qimem_registration_bonus_transactions
  (player_id, amount, reason, round_id)
SELECT player_id, -10.00, 'bingo_stake', $2::bigint
FROM debited
RETURNING player_id, amount, round_id;
