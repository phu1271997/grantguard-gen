# Changelog

## [0.2.0] — hardening + live-verified

### Fixed
- **Runtime bug in `withdraw()`**: `gl.message.send_value(who, amount)` is not
  part of the GenLayer SDK; every withdrawal would have crashed the tx and
  frozen approved tranches in the contract. Replaced with the SDK-native
  `gl.chain.Account(who).emit_transfer(amount)`, ordered
  effects-before-interactions.
- **Runtime bug in `review_milestone()`**: `gl.eq_principle.prompt_comparative`
  has the signature `(fn, principle, /)` — the `principle=` keyword form used
  before was a `TypeError`, and every review would have reverted before
  reaching consensus. The principle text is now passed positionally.

### Added
- **`MIN_APPROVAL_CONFIDENCE = 60`**: an `APPROVE` verdict below the threshold
  is downgraded to `REJECT` and the reason quotes the original AI
  justification. Prevents a hesitant judgment from releasing funds.
- **`frontend/scripts/verify_live.mjs`** + `npm run verify:live` — wallet-free
  live probe that confirms the deployed contract's schema and reads
  `total_grants` against studionet.
- **Recent grants panel** in the dApp: on load, the frontend lists the newest
  on-chain grants (id, status, released totals) and lets the reviewer jump
  straight into a live record without knowing an id.
- **Explorer link** in the header, wired off `studionet.explorer` so reviewers
  can jump to `explorer-studio.genlayer.com` from the app.
- **`tsconfig.json`** with strict TS; `npm run build` now typechecks the
  source before Vite bundles it. All TS errors resolved.
- **Real gltest suite** (`tests/test_grantguard.py`): nine tests covering
  deposit accounting, guard clauses, state-machine transitions, and the
  `withdraw()` empty-ledger revert, written against the fluent
  `contract.connect(acct).method(args=[...]).transact(value=X)` API. Runs on
  `gltest --network localnet` or `gltest --network studionet`.

### Changed
- README, ARCHITECTURE, and `scripts/deploy.md` now describe the studionet
  deployment and the seed procedure for the Explorer listing, and drop every
  `TODO: verify` marker that was flagged against the (now-verified) SDK
  surface.
- Frontend `genlayer.ts` exposes `contractExplorerUrl()`, `txExplorerUrl()`,
  and `listRecentGrants()` used by the UI additions above.

## [0.1.0] — initial build

### Added
- `contracts/grantguard.py`: Intelligent Contract with the full grant
  lifecycle (create → submit → review → release/reject → complete), the
  non-deterministic AI milestone reviewer under `eq_principle.prompt_comparative`
  consensus, up-front fund locking with exact deposit accounting, pull-
  withdrawal payouts, and constrained cancellation.
- `contracts/storage_test.py`: minimal sanity contract for pre-deploy checks.
- `frontend/index.html`: standalone dApp covering create grant → submit proof
  → request review → tranche release, with a milestone-gate visualization.
- `frontend/src/lib/genlayer.ts`: typed `genlayer-js` client helpers.
- `tests/test_grantguard.py`: happy-path and edge-case test scaffolding.
- `scripts/deploy.md`, `README.md`, `ARCHITECTURE.md`.
