# Deploy guide — GenLayer Studio

> Respect these Studio quirks or deploys fail in confusing ways.

## Pre-flight (every contract file)

1. **Line 1** is exactly `# v0.2.16`.
2. **Line 2** is the `# { "Depends": "py-genlayer:..." }` comment.
3. No `TreeMap()` / `DynArray()` assignment inside `__init__`.
4. No `float` in any public method signature.
5. Storage uses `TreeMap` / `DynArray` only (never `dict` / `list`).
6. Main class is named exactly `Contract` and extends `gl.Contract`.
7. Every `web.render` / `exec_prompt` is wrapped (via
   `gl.eq_principle.prompt_comparative`, or the `run_nondet_unsafe` fallback).
8. Only `from genlayer import *` — never `import genlayer`.

## Steps

1. Open https://studio.genlayer.com/run-debug
2. **Settings -> Reset Storage -> Confirm**
3. **Hard refresh** (Cmd+Shift+R / Ctrl+Shift+F5)
4. Deploy **`contracts/storage_test.py`** first.
   - Call `put("hello","world")`, then `get("hello")` -> expect `"world"`.
   - Click the transaction; confirm **Result: SUCCESS** (not just FINALIZED).
5. If sanity passes, deploy **`contracts/grantguard.py`**.
6. Copy the deployed address into `frontend/.env`
   (`VITE_GRANTGUARD_CONTRACT_ADDRESS`).

## Smoke test on testnet

1. From the funder account: `create_grant("Test grant", <grantee>,
   ["Publish dataset v1"], [50])` with attached value `50` -> returns id `0`.
2. From the grantee account: `submit_milestone(0, 0, "https://…/proof")`.
3. From any account: `review_milestone(0, 0)` — reads the URL live and runs the
   LLM reviewer; slower than a normal tx while consensus is reached.
4. `get_milestone(0, 0)` -> inspect `status` / `reason` / `confidence`.
5. On APPROVE, grantee calls `withdraw()`.

## If something errors

- `Contract Queues not found` -> missing `# v0.2.16` header (rule 1).
- `AssertionError: TreeMap <- TreeMap` -> TreeMap assigned in `__init__` (rule 3).
- Schema / compile error -> forbidden type in a public signature (rules 4-5).
- `AttributeError: module 'genlayer' has no attribute 'Contract'` -> re-imported
  genlayer (rule 8).
