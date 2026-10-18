-- STAGING ONLY. Round price is set only by the trusted game coordinator.
-- A row must be created only after verifying the corresponding live round ID,
-- room type and card price. No client-side values are authoritative.
CREATE TABLE IF NOT EXISTS qimem_round_pricing_authority (
  round_id bigint PRIMARY KEY REFERENCES qimem_bingo_rounds(id),
  room_type text NOT NULL CHECK (room_type IN ('10','20')),
  card_price_etb numeric(12,2) NOT NULL CHECK (card_price_etb IN (10.00,20.00)),
  verified_by text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((room_type='10' AND card_price_etb=10.00) OR
         (room_type='20' AND card_price_etb=20.00))
);
-- The bonus purchase function must check this table INSIDE the same transaction,
-- not merely trust a check in the HTTP handler.
-- Do not populate this table from Telegram Mini App requests.
