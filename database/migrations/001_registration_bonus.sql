-- QIMEM BINGO: registration bonus ledger (staging migration)
-- No changes to existing wallet or player tables.
-- Apply only after verifying backups and staging tests.
CREATE TABLE IF NOT EXISTS qimem_registration_bonus_accounts (
  player_id bigint PRIMARY KEY REFERENCES qimem_players(id),
  granted_amount numeric(12,2) NOT NULL DEFAULT 10.00 CHECK (granted_amount = 10.00),
  available_amount numeric(12,2) NOT NULL DEFAULT 10.00 CHECK (available_amount >= 0 AND available_amount <= granted_amount),
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS qimem_registration_bonus_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_id bigint NOT NULL REFERENCES qimem_registration_bonus_accounts(player_id),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('registration_grant','bingo_stake','stake_refund')),
  round_id bigint REFERENCES qimem_bingo_rounds(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS qimem_registration_bonus_one_grant
  ON qimem_registration_bonus_transactions(player_id)
  WHERE reason = 'registration_grant';
CREATE INDEX IF NOT EXISTS qimem_registration_bonus_transactions_player_idx
  ON qimem_registration_bonus_transactions(player_id,created_at);
