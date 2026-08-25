# Deploy guide — GrantGuard on GenLayer Studio (studionet)

The project ships on **studionet** (`https://studio.genlayer.com`). Do not use
the testnet faucet — the deployed contract lives on studionet only, and the
frontend's `chain: studionet` must match.

## Pre-flight (every contract file)

1. Line 1 is exactly `# v0.2.16`.
2. Line 2 is the `# { "Depends": "py-genlayer:..." }` comment.
3. No `TreeMap()` / `DynArray()` assignment inside `__init__`.
4. No `float` in any public method signature.
5. Storage uses `TreeMap` / `DynArray` only (never `dict` / `list`).
6. The main class is named `Contract` and extends `gl.Contract`.
7. Every `gl.nondet.web.render` / `gl.nondet.exec_prompt` call sits inside
   `gl.eq_principle.*` or `gl.vm.run_nondet*`.
8. Only `from genlayer import *` — never `import genlayer`.
9. Value transfers use `gl.chain.Account(addr).emit_transfer(amount)`, not the
   non-existent `gl.message.send_value(...)`.

## Deploy

1. Open <https://studio.genlayer.com/run-debug>.
2. **Settings → Reset Storage → Confirm → hard refresh** (`Cmd+Shift+R`).
3. Deploy `contracts/storage_test.py` first. Call `put("hello", "world")` then
   `get("hello")`; open the transaction row and confirm **Result: SUCCESS**
   (not just `Status: FINALIZED`).
4. Deploy `contracts/grantguard.py`. Confirm **Result: SUCCESS** the same way.
5. Copy the deployed address into `frontend/.env` as
   `VITE_GRANTGUARD_CONTRACT_ADDRESS=0x…`.

## Verify the deployment from the outside

Anyone can run this without a wallet:

```bash
cd frontend
npm install                 # once
npm run verify:live         # reads .env, hits studionet RPC
```

Expected output:

```
✓ schema exposes all 9 required methods
✓ total_grants = <N>
✓ live contract is healthy
```

If it fails on schema, the Studio storage was reset — redeploy the contract.

## Seed on-chain state before the demo (needed for Explorer)

`review_milestone` cannot be exercised without a real evidence page and GEN in
the caller's wallet. Seed at least one grant per outcome so an Explorer
reviewer can see the AI decision surface without connecting a wallet.

**Prerequisites**

- MetaMask on GenLayer Studio Network (chainId `0xF1EF` / `61999`, RPC
  `https://studio.genlayer.com/api`, symbol `GEN`).
- Two GenLayer accounts, both funded from the Studio **Accounts** panel:
  - `FUNDER` — the account that will lock the grant (~200 GEN is plenty for
    the three demo grants below).
  - `GRANTEE` — the account that will submit evidence (needs a small amount to
    cover gas; ~1 GEN).

**Seed set (open the live app for each)**

1. **Grant A — happy path (APPROVE / RELEASED).**
   Title `Open dataset — Phase 1`. Milestone: `Publish v1 with a readme` at
   `10 GEN`. From FUNDER: create → lock 10 GEN. From GRANTEE: submit a real,
   readable URL that clearly matches the deliverable (e.g. a GitHub repo README
   describing the dataset). Request AI review. Expect status → **RELEASED**,
   grantee `withdrawable` = 10 GEN.

2. **Grant B — reject path (REJECTED, no funds moved).**
   Title `Bug bounty writeup`. Milestone: `Public writeup of CVE-YYYY-…` at
   `5 GEN`. From GRANTEE: submit a URL that is clearly off-topic (e.g. an empty
   Gist, an unrelated blog post, or a dead page). Request AI review. Expect
   status → **REJECTED**, `reason` explaining the mismatch, no `withdrawable`
   change.

3. **Grant C — completed multi-milestone grant.**
   Title `Research report — Q1 milestones`. Two milestones, both with
   substantive evidence URLs, total `12 GEN`. Approve both. Grant status →
   **COMPLETE**, grantee has 12 GEN pending withdrawal.

Verify from the outside:

```bash
npm run verify:live   # total_grants should now be >= 3
```

Then open the live app in an incognito window with no wallet connected. Load
grant `0`, `1`, and `2` in the ledger — the AI verdict, confidence, and reason
should all be readable without signing anything.

## If something errors

| Symptom | Fix |
|---|---|
| `Contract Queues not found` | Rule 1 — the `# v0.2.16` header is missing / moved |
| `AssertionError: TreeMap <- TreeMap` | Rule 3 — `TreeMap()` reassigned in `__init__` |
| `Could not load contract schema` | Rule 4 or 5 — forbidden type in a public signature or storage |
| `AttributeError: module 'genlayer.gl' has no attribute 'eth'` | Rule 9 — you re-added `gl.eth.send_value`; use `gl.chain.Account(who).emit_transfer(amount)` |
| Live app write reverts with `'from'` | MetaMask is on the wrong chain — reconnect the wallet, the app calls `writeClient.connect(NETWORK)` which switches / adds the chain automatically |
| `insufficient funds` on `create_grant` | Fund the connected account from Studio → Accounts. The studionet faucet page does NOT top up studionet balances |
