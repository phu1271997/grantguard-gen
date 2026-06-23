# Architecture — GrantGuard

## Components

- **`contracts/grantguard.py`** — the Intelligent Contract. Holds grants,
  milestones, locked balances, AI decisions, and a pull-withdrawal ledger. The
  core release decision runs in `review_milestone()` via web + LLM consensus.
- **`contracts/storage_test.py`** — disposable sanity contract for the Studio
  environment before the real deploy.
- **`frontend/`** — `genlayer-js` client + UI (create grant, submit proof,
  request review, see the AI verdict release each tranche).

## Grant + milestone state machines

```
GRANT:   OPEN ──(all milestones RELEASED)──► COMPLETE
              └─(funder, before any submission)─► CANCELLED

MILESTONE: LOCKED ──submit──► SUBMITTED ──review──► RELEASED
                                   │  (REJECT)
                                   └──────────────► REJECTED ──resubmit──► SUBMITTED
```

## review_milestone() — the non-deterministic core

```mermaid
sequenceDiagram
    participant U as Caller
    participant C as GrantGuard
    participant W as web.render
    participant L as exec_prompt (LLM)
    participant V as Validators

    U->>C: review_milestone(grant_id, index)
    C->>W: render(evidence_url)
    W-->>C: page text
    C->>L: "was this milestone met in spirit?" -> JSON {verdict, confidence, reason}
    L-->>C: leader result
    C->>V: eq_principle.prompt_comparative (agree on verdict + confidence±15)
    V-->>C: consensus decision
    alt verdict = APPROVE
        C->>C: locked -= payout; credit grantee; status = RELEASED
        C->>C: if all released -> grant COMPLETE
    else verdict = REJECT / dead URL / bad JSON
        C->>C: status = REJECTED (no funds move; grantee may resubmit)
    end
```

## Consensus design (contract quality)

Validators must agree on the **meaning** of the decision — `verdict` must match
and `confidence` within 15 points — not on JSON shape. Two validators that
disagree on APPROVE vs REJECT will fail consensus rather than both passing a
schema check. That is the line between a real subjective reviewer and a JSON
validator.

## Money safety

- **Funds locked up front:** deposit must equal the exact sum of milestone
  payouts; the contract never releases more than the remaining locked balance.
- **Pull-withdrawal:** approvals credit `withdrawable[address]`; funds leave only
  via an explicit `withdraw()`, never pushed during the consensus path.
- **Cancellation is constrained:** a funder can only reclaim before any milestone
  has been submitted, so a grantee's in-progress work can't be pulled out from
  under them.

## Edge cases handled

| Case | Behavior |
|------|----------|
| Deposit ≠ sum of payouts | `create_grant` rejects |
| Zero payout | `create_grant` rejects |
| Funder == grantee | rejected |
| Non-grantee submits | rejected |
| Non-funder cancels | rejected |
| Cancel after a submission | rejected |
| Review when not SUBMITTED | rejected |
| Dead / empty / off-topic evidence | LLM REJECT → no funds move |
| Malformed verdict JSON | defaults to REJECT → no funds move |
| Payout > remaining locked | clamped to remaining balance |
