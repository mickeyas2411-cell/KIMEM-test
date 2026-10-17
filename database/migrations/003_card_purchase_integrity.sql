-- Draft migration 003: card ownership uniqueness and idempotent purchase record.
-- REVIEW BEFORE APPLYING. Existing duplicates must be reconciled first.
-- A card number may have only one row per round, whether sold or unassigned.
-- Check duplicates: SELECT round_id,card_number,count(*) FROM qimem_round_cards
-- GROUP BY round_id,card_number HAVING count(*)>1;
CREATE UNIQUE INDEX IF NOT EXISTS qimem_round_cards_round_card_unique
 ON qimem_round_cards(round_id,card_number);

-- A purchase idempotency key must be scoped to the player, and repeated requests
-- must return the same purchase rather than debiting again.
CREATE TABLE IF NOT EXISTS qimem_card_purchase_requests(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 player_id bigint NOT NULL REFERENCES qimem_players(id),
 round_id bigint NOT NULL REFERENCES qimem_bingo_rounds(id),
 card_number integer NOT NULL CHECK(card_number>0),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
 funding_source text NOT NULL CHECK(funding_source IN ('bonus','real')),
 amount numeric(12,2) NOT NULL CHECK(amount>0),
 card_id bigint REFERENCES qimem_round_cards(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(player_id,request_key),
 UNIQUE(card_id)
);
-- Keep 20 ETB mixed funding disabled until split accounting is designed and tested.
