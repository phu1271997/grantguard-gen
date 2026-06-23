# GrantGuard — Milestone grants released by an on-chain AI reviewer

> A funder locks a grant up front, split into milestones. The grantee submits a
> link as proof for each milestone — a public transcript, a paper, a repository.
> GrantGuard's Intelligent Contract **reads that page from the live web** and an
> **AI reviewer judges whether the deliverable was genuinely met** before
> releasing that tranche. No blind disbursement, no human grant officer.

**One-line pitch:** *GrantGuard dies without GenLayer, because deciding "was this
qualitative milestone actually achieved?" requires reading the open web and
forming a subjective judgment on-chain — something Solidity fundamentally cannot do.*

---

## The problem

Grants, scholarships, and research funding are disbursed on trust and slow manual
review. Funds either go out blindly against a checkbox, or a human officer reads
the deliverable and decides — slow, centralized, and subjective. There is no
clean numeric oracle for "the dataset was actually published with docs" or "the
paper meets the milestone."

## Why Solidity can't do this

A traditional smart contract can hold and release funds, but it **cannot open a
transcript, paper, or repo, read it, and form a judgment** that a qualitative
deliverable was genuinely met. Pushing that judgment off-chain reintroduces the
trusted intermediary GrantGuard removes.

## How GenLayer solves it

The release decision runs inside the contract, wrapped in validator consensus:

1. **`gl.nondet.web.render(url, mode="text")`** — the contract opens the
   grantee's evidence URL and reads its actual content on-chain.
2. **`gl.nondet.exec_prompt(task, response_format="json")`** — an LLM judges
   whether the evidence demonstrates the milestone was met *in spirit*, returning
   `verdict` (APPROVE/REJECT), `confidence`, and `reason`.

Consensus is reached on the **meaning** of the decision (via
`gl.eq_principle.prompt_comparative`): validators must agree on APPROVE vs REJECT,
not on exact JSON bytes. Only an APPROVE moves money.

```
funder locks total ──► milestone gates [LOCKED]
grantee submits URL ──► [SUBMITTED]
       review_milestone() ──► web.render(url) ──► exec_prompt (judge "met in spirit?")
                                       │ consensus on APPROVE/REJECT
                       ┌───────────────┴───────────────┐
                   APPROVE                          REJECT
              release tranche [RELEASED]      no funds; grantee may resubmit [REJECTED]
       all milestones released ──► grant COMPLETE
```

---

## Repo structure

```
grantguard/
├── contracts/
│   ├── grantguard.py     # the Intelligent Contract (core)
│   └── storage_test.py   # minimal sanity contract — deploy FIRST
├── frontend/
│   ├── index.html        # standalone demo UI (full UX, demo mode)
│   ├── src/lib/genlayer.ts
│   ├── package.json
│   └── .env.example
├── tests/
│   └── test_grantguard.py
├── scripts/
│   └── deploy.md
├── ARCHITECTURE.md
├── CHANGELOG.md
└── README.md
```

---

## Contract interface

- `create_grant(title, grantee, descriptions[], payouts[])` (payable) — funder
  locks a deposit equal to the sum of payouts; returns `grant_id`.
- `submit_milestone(grant_id, index, evidence_url)` — grantee attaches proof.
- `review_milestone(grant_id, index)` — runs the AI reviewer; APPROVE releases
  the tranche, REJECT lets the grantee resubmit.
- `cancel_grant(grant_id)` — funder reclaims funds, only before any submission.
- `withdraw()` — pull-pattern payout of any owed balance.
- views: `get_grant`, `get_milestone`, `get_withdrawable`, `total_grants`.

---

## ⚠️ Unverified API surface — read before trusting

GenLayer's SDK and `genlayer-js` are young. Several API names are the *most
plausible* but **not verified against a live SDK**, and are flagged with
`# TODO: verify` / `// TODO: verify`. Check these against official GenLayer docs:

- native value/transfer primitive (`gl.message.send_value`, `.value`, `.sender_address`)
- whether `gl.eq_principle.prompt_comparative` exists in `v0.2.16` (else fall back
  to `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`)
- nested storage-struct syntax (contract uses parallel TreeMaps as a safe fallback)
- the `genlayer-js` client factory + read/write method names in `genlayer.ts`

The deterministic logic (state machine, deposit accounting, guard clauses, payout
math, edge cases) does not depend on these and should hold regardless.

---

## Run the frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend now talks to the live contract configured in `frontend/.env`:

- contract: `0xACe566a3440c2A5f37c32616F1C59625ac8EA2B9`
- network: `studionet`
- RPC: `https://studio.genlayer.com/api`

Reads work immediately against GenLayer RPC. Writes require a browser wallet
such as MetaMask, and the app switches the wallet to the configured GenLayer
network through `genlayer-js`.

## Deploy the contract

See [`scripts/deploy.md`](scripts/deploy.md). Deploy `storage_test.py` first,
confirm **Result: SUCCESS**, then deploy `grantguard.py`.
