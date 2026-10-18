# Bonus balance endpoint contract

This document is a proposed integration contract, not a deployed API.

GET /api/me/balances requires server-verified Telegram Mini App initData.

Successful response example:

```json
{"ok":true,"balances":{"real_etb":"0.00","bonus_etb":"10.00"}}
```

Use server-authoritative wallet records for real balance. Reconcile existing Durable Object balances before any migration. Use Neon registration bonus account balance for play-only bonus. Never infer real balance from localStorage, never grant bonus on GET, and return Cache-Control: no-store.

UI must show an unavailable marker until authenticated values are available. All balance-changing operations require atomic database transactions and idempotent ledger entries. No live deployment until staging tests pass.
