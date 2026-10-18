-- KIMEM registration idempotency regression test.
-- Run only on isolated Neon staging branch.
-- This anonymous block always rolls back all synthetic writes.
DO $test$
DECLARE p bigint; granted boolean; bonus_balance numeric;
DECLARE wc integer; bc integer; lc integer; iteration integer;
BEGIN
 BEGIN
  FOR iteration IN 1..2 LOOP
   WITH player AS (
    INSERT INTO qimem_players(telegram_id,username,first_name,last_name)
    VALUES (899999999991234,'staging_bot','Staging','Test')
    ON CONFLICT(telegram_id) DO UPDATE SET
      username=EXCLUDED.username,
      first_name=EXCLUDED.first_name,
      last_name=EXCLUDED.last_name,
      updated_at=now()
    RETURNING id
   ),
   wallet AS (
    INSERT INTO qimem_wallets(player_id,available_balance,held_balance)
    SELECT id,0,0 FROM player
    ON CONFLICT(player_id) DO NOTHING
    RETURNING player_id
   ),
   bonus AS (
    INSERT INTO qimem_registration_bonus_accounts(player_id,granted_amount,available_amount)
    SELECT id,10.00,10.00 FROM player
    ON CONFLICT(player_id) DO NOTHING
    RETURNING player_id,granted_amount
   ),
   bonus_log AS (
    INSERT INTO qimem_registration_bonus_transactions(player_id,amount,reason)
    SELECT player_id,granted_amount,'registration_grant' FROM bonus
    RETURNING player_id
   )
   SELECT player.id, EXISTS(SELECT 1 FROM bonus_log)
   INTO p,granted FROM player;

   IF granted IS DISTINCT FROM (iteration=1) THEN
    RAISE EXCEPTION 'Wrong bonus grant flag on registration %',iteration;
   END IF;
  END LOOP;

  SELECT available_amount INTO bonus_balance
  FROM qimem_registration_bonus_accounts WHERE player_id=p;
  SELECT count(*) INTO wc FROM qimem_wallets WHERE player_id=p;
  SELECT count(*) INTO bc FROM qimem_registration_bonus_accounts WHERE player_id=p;
  SELECT count(*) INTO lc FROM qimem_registration_bonus_transactions
  WHERE player_id=p AND reason='registration_grant';

  IF bonus_balance<>10 OR wc<>1 OR bc<>1 OR lc<>1 THEN
   RAISE EXCEPTION 'Registration not idempotent: wallet %, bonus %, grants %, balance %',
     wc,bc,lc,bonus_balance;
  END IF;

  RAISE EXCEPTION 'REGISTRATION_STAGING_TEST_PASSED_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'REGISTRATION_STAGING_TEST_PASSED_ROLLBACK' THEN RAISE; END IF;
 END;
END $test$;
