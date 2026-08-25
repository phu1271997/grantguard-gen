# Architecture — GrantGuard

## Components

- **`contracts/grantguard.py`** — the Intelligent Contract. Holds grants,
  milestones, locked balances, AI decisions, and a pull-withdrawal ledger. The
  core release decision runs in `review_milestone()` via web + LLM under
  validator consensus.
- **`contracts/storage_test.py`** — throwaway sanity contract for the Studio
  environment before the real deploy.
- **`frontend/`** — a `genlayer-js` client + Vite/TS UI. On boot it schema-checks
  the deployed contract, lists the newest grants on-chain, and lets a funder or
  grantee sign the create / submit / review / cancel / withdraw path with any
  EIP-1193 wallet on studionet.
- **`frontend/scripts/verify_live.mjs`** — wallet-free health probe reachable
  from `npm run verify:live`. Confirms schema and reads `total_grants`.
- **`tests/test_grantguard.py`** — pytest / `gltest` suite exercising the
  deterministic state machine and guard clauses.

## Grant + milestone state machines

```
GRANT:   OPEN ──(all milestones RELEASED)──► COMPLETE
              └─(funder, before any submission)─► CANCELLED

MILESTONE: LOCKED ──submit──► SUBMITTED ──review──► RELEASED
                                   │  (REJECT / low confidence / bad JSON / dead URL)
                                   └──────────────► REJECTED ──resubmit──► SUBMITTED
```

## `review_milestone()` — the non-deterministic core

```mermaid
sequenceDiagram
    participant U as Caller
    participant C as GrantGuard
    participant W as gl.nondet.web.render
    participant L as gl.nondet.exec_prompt (LLM)
    participant V as Validators

    U->>C: review_milestone(grant_id, index)
    C->>W: render(evidence_url, mode="text")
    W-->>C: page text
    C->>L: "was this milestone met in spirit?" → JSON {verdict, confidence, reason}
    L-->>C: leader result
    C->>V: gl.eq_principle.prompt_comparative (verdict match + confidence ±15)
    V-->>C: consensus decision
    alt verdict = APPROVE and confidence >= 60
        C->>C: locked -= payout; credit grantee; status = RELEASED
        C->>C: if all released → grant COMPLETE
    else REJECT / low confidence / dead URL / bad JSON
        C->>C: status = REJECTED (no funds move; grantee may resubmit)
    end
```

## Consensus design

Validators must agree on the **meaning** of the decision — `verdict` must
match and `confidence` must sit within 15 points — not on JSON shape. Two
validators that disagree on `APPROVE` vs `REJECT` fail consensus rather than
both passing a schema check; two validators that reach the same verdict but
write different rationales pass. That is the line between a real subjective
reviewer and a JSON validator.

`MIN_APPROVAL_CONFIDENCE = 60/100` sits on top: an `APPROVE` verdict that
falls under the threshold is downgraded to `REJECT` before any money moves,
with a `reason` that quotes the original AI justification and asks the
grantee to strengthen the evidence.

## Money safety

- **Funds locked up front.** The deposit must equal the exact sum of milestone
  payouts, and the contract never releases more than the remaining locked
  balance for a grant.
- **Pull-withdrawal.** Approvals credit `withdrawable[address]`; funds only
  leave the contract on an explicit `withdraw()`, never pushed during the
  consensus path.
- **Effects-before-interactions.** `withdraw()` zeroes the caller's ledger
  entry *before* calling `gl.chain.Account(who).emit_transfer(amount)`, so a
  re-entering call finds nothing to pull.
- **Cancellation is constrained.** A funder can only reclaim before any
  milestone has been submitted; a grantee's in-progress work cannot be pulled
  out from under them.

## Edge cases handled

| Case | Behavior |
|------|----------|
| Deposit ≠ sum of payouts | `create_grant` reverts |
| Zero payout | `create_grant` reverts |
| Descriptions / payouts length mismatch | `create_grant` reverts |
| Funder == grantee | `create_grant` reverts |
| Non-grantee submits | `submit_milestone` reverts |
| Non-funder cancels | `cancel_grant` reverts |
| Cancel after any submission | `cancel_grant` reverts |
| Review when not `SUBMITTED` | `review_milestone` reverts |
| Dead / empty / off-topic evidence | AI returns `REJECT` → no funds move |
| Malformed verdict JSON | defaults to `REJECT` → no funds move |
| Low-confidence `APPROVE` (`< 60/100`) | downgraded to `REJECT` → no funds move |
| Payout > remaining locked balance | clamped to the remaining balance |
| Withdrawal with zero balance | reverts (`Nothing to withdraw`) |
