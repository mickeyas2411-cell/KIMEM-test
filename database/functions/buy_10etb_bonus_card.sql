-- STAGING ONLY. Requires migrations 001, 002 and 003.
-- Assumes cards are pre-created with player_id NULL. The application must
-- supply a server-verified player ID and a stable request key (16..128 chars).
-- No 20 ETB mixed funding and no real-money debit in this function.
CREATE OR REPLACE FUNCTION qimem_buy_10etb_bonus_card(
  p_player_id bigint, p_round_id bigint, p_card_number integer, p_request_key text
) RETURNS TABLE(purchase_id bigint, card_id bigint, charged boolean)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
 v_prior qimem_card_purchase_requests%ROWTYPE;
 v_card_id bigint;
 v_balance numeric;
 v_round_status text;
 v_purchase_id bigint;
BEGIN
 IF p_player_id IS NULL OR p_round_id IS NULL OR p_card_number IS NULL
    OR p_card_number<=0 OR p_request_key IS NULL
    OR length(p_request_key) NOT BETWEEN 16 AND 128 THEN
   RAISE EXCEPTION 'invalid purchase request';
 END IF;
 -- Serialize same player's same request key, including concurrent retries.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_player_id::text||':'||p_request_key,0));
 SELECT * INTO v_prior FROM qimem_card_purchase_requests
 WHERE player_id=p_player_id AND request_key=p_request_key;
 IF FOUND THEN
   IF v_prior.round_id<>p_round_id OR v_prior.card_number<>p_card_number
      OR v_prior.funding_source<>'bonus' OR v_prior.amount<>10.00
      OR v_prior.card_id IS NULL THEN
     RAISE EXCEPTION 'idempotency key reused with different purchase';
   END IF;
   RETURN QUERY SELECT v_prior.id,v_prior.card_id,false;
   RETURN;
 END IF;
 -- Lock the round, then the card, then the bonus account.
 SELECT status INTO v_round_status FROM qimem_bingo_rounds
 WHERE id=p_round_id FOR UPDATE;
 IF NOT FOUND OR v_round_status<>'waiting' THEN
   RAISE EXCEPTION 'round not accepting purchases';
 END IF;
 SELECT id INTO v_card_id FROM qimem_round_cards
 WHERE round_id=p_round_id AND card_number=p_card_number AND player_id IS NULL
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'card unavailable'; END IF;
 UPDATE qimem_registration_bonus_accounts
 SET available_amount=available_amount-10.00
 WHERE player_id=p_player_id AND available_amount>=10.00
 RETURNING available_amount INTO v_balance;
 IF NOT FOUND THEN RAISE EXCEPTION 'insufficient bonus balance'; END IF;
 UPDATE qimem_round_cards SET player_id=p_player_id,price=10.00
 WHERE id=v_card_id AND player_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'card unavailable'; END IF;
 INSERT INTO qimem_registration_bonus_transactions(player_id,amount,reason,round_id)
 VALUES(p_player_id,-10.00,'bingo_stake',p_round_id);
 INSERT INTO qimem_card_purchase_requests(
  player_id,round_id,card_number,request_key,funding_source,amount,card_id
 ) VALUES(p_player_id,p_round_id,p_card_number,p_request_key,'bonus',10.00,v_card_id)
 RETURNING id INTO v_purchase_id;
 RETURN QUERY SELECT v_purchase_id,v_card_id,true;
END $$;
-- Any exception rolls back the entire statement (card, balance, ledger, purchase).
-- Do not expose this function directly to untrusted clients.
