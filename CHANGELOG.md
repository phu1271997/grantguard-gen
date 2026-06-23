# Changelog

## [0.1.0] — initial build

### Added
- `contracts/grantguard.py`: Intelligent Contract with the full grant lifecycle
  (create → submit → review → release/reject → complete), the non-deterministic
  AI milestone reviewer (`web.render` + `exec_prompt`) under
  `eq_principle.prompt_comparative` consensus, up-front fund locking with exact
  deposit accounting, pull-withdrawal payouts, and constrained cancellation.
- `contracts/storage_test.py`: minimal sanity contract for pre-deploy checks.
- `frontend/index.html`: standalone demo UI covering create grant → submit proof
  → request review → tranche release, with a clearly labeled demo mode and a
  milestone-gate visualization.
- `frontend/src/lib/genlayer.ts`: typed `genlayer-js` client helpers.
- `tests/test_grantguard.py`: happy-path and edge-case test scaffolding.
- `scripts/deploy.md`, `README.md`, `ARCHITECTURE.md`.

### Notes
- Several GenLayer/genlayer-js API names are flagged `TODO: verify` pending a
  check against the live SDK (transfer primitive, consensus API availability,
  nested struct syntax, genlayer-js method names).
