-- STAGING ONLY: execute within an explicit transaction and ROLLBACK.
-- Assertions: unverified round rejected, 20 ETB room rejected,
-- verified 10 ETB round accepted, repeated request not double-charged.
BEGIN;
DO $$
DECLARE p bigint; r bigint; c bigint; id1 bigint; charged1 boolean; balance numeric; n int; rejected boolean;
BEGIN
 INSERT INTO qimem_players(telegram_id) VALUES(899999999999551) RETURNING id INTO p;
 INSERT INTO qimem_registration_bonus_accounts(player_id) VALUES(p);
 INSERT INTO qimem_bingo_rounds(status) VALUES('waiting') RETURNING id INTO r;
 INSERT INTO qimem_round_cards(round_id,card_number) VALUES(r,21) RETURNING id INTO c;
 rejected:=false;
 BEGIN
  PERFORM * FROM qimem_buy_10etb_bonus_card(p,r,21,'staging-unverified-551');
 EXCEPTION WHEN OTHERS THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'unverified round accepted'; END IF;
 INSERT INTO qimem_round_pricing_authority(round_id,room_type,card_price_etb,verified_by)
 VALUES(r,'20',20,'staging-test');
 rejected:=false;
 BEGIN
  PERFORM * FROM qimem_buy_10etb_bonus_card(p,r,21,'staging-wrong-room-551');
 EXCEPTION WHEN OTHERS THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION '20 ETB room accepted'; END IF;
 UPDATE qimem_round_pricing_authority SET room_type='10',card_price_etb=10 WHERE round_id=r;
 SELECT purchase_id,charged INTO id1,charged1
 FROM qimem_buy_10etb_bonus_card(p,r,21,'staging-valid-room-551');
 IF NOT charged1 THEN RAISE EXCEPTION 'valid purchase not charged'; END IF;
 SELECT purchase_id,charged INTO id1,charged1
 FROM qimem_buy_10etb_bonus_card(p,r,21,'staging-valid-room-551');
 IF charged1 THEN RAISE EXCEPTION 'duplicate charge'; END IF;
 SELECT available_amount INTO balance FROM qimem_registration_bonus_accounts WHERE player_id=p;
 SELECT count(*) INTO n FROM qimem_registration_bonus_transactions
 WHERE player_id=p AND reason='bingo_stake';
 IF balance<>0 OR n<>1 THEN RAISE EXCEPTION 'balance/ledger mismatch'; END IF;
 RAISE NOTICE 'staging assertions passed';
END $$;
ROLLBACK;
