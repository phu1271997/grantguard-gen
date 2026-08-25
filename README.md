# GrantGuard — Milestone grants released by an on-chain AI reviewer

> A funder locks a grant up front, split into milestones. The grantee submits a
> link as proof for each milestone — a public transcript, a paper, a
> repository. GrantGuard's Intelligent Contract **reads that page from the live
> web** and an **AI reviewer judges whether the deliverable was genuinely met**
> before releasing that tranche. No blind disbursement, no human grant officer.

**One-line pitch.** *GrantGuard dies without GenLayer, because deciding "was
this qualitative milestone actually achieved?" needs to open the open web,
read it, and form a subjective judgment on-chain — something Solidity cannot
do.*

- **Network:** [studionet](https://studio.genlayer.com) — status: **Preview**
- **Contract:** [`0xACe566a3440c2A5f37c32616F1C59625ac8EA2B9`](https://explorer-studio.genlayer.com/address/0xACe566a3440c2A5f37c32616F1C59625ac8EA2B9)
- **Live app:** <https://grantguard-gen.vercel.app>

---

## The problem

Grants, scholarships, and research funding are disbursed on trust and slow
manual review. Funds either go out blindly against a checkbox, or a human
officer reads the deliverable and decides. There is no clean numeric oracle
for "the dataset was actually published with docs" or "the paper meets the
milestone." Solidity smart contracts can hold and move money, but they cannot
open a transcript, paper, or repo, read it, and form a judgment that a
qualitative deliverable was genuinely met — pushing that judgment off-chain
re-introduces the trusted intermediary GrantGuard removes.

## How GenLayer solves it

The release decision runs inside the contract, wrapped in validator consensus:

1. **`gl.nondet.web.render(url, mode="text")`** — the contract opens the
   grantee's evidence URL and reads its actual content on-chain.
2. **`gl.nondet.exec_prompt(task, response_format="json")`** — an LLM judges
   whether the evidence demonstrates the milestone was met *in spirit*, and
   returns `verdict` (`APPROVE`/`REJECT`), `confidence` (0–100), and `reason`.

Consensus is reached on the **meaning** of the decision, not on exact JSON
bytes: `gl.eq_principle.prompt_comparative` requires the validators to agree
on the verdict AND on `confidence` within 15 points; the free-form `reason`
text is deliberately allowed to vary. Two validators that disagree on
`APPROVE` vs `REJECT` fail consensus rather than both passing a schema check.

An `APPROVE` verdict with confidence below the release threshold (`60/100`) is
downgraded to `REJECT` and the grantee is asked to strengthen the evidence,
so a hesitant judgment never releases funds.

```
funder locks total ──► milestone gates [LOCKED]
grantee submits URL ──► [SUBMITTED]
       review_milestone() ──► web.render(url) ──► exec_prompt (judge "met in spirit?")
                                        │ consensus on APPROVE/REJECT (+ confidence ±15)
                       ┌────────────────┴────────────────┐
                   APPROVE (conf ≥ 60)             REJECT / low confidence / bad JSON / dead URL
              release tranche [RELEASED]        no funds; grantee may resubmit [REJECTED]
       all milestones released ──► grant COMPLETE
```

## Contract interface

- `create_grant(title, grantee, descriptions[], payouts[])` — **payable**. The
  attached value must equal the exact sum of `payouts`. Returns `grant_id`.
- `submit_milestone(grant_id, index, evidence_url)` — grantee-only.
- `review_milestone(grant_id, index)` — runs the AI reviewer; `APPROVE`
  credits the tranche to the grantee's pull-withdrawal ledger.
- `cancel_grant(grant_id)` — funder-only, and only before any milestone has
  been submitted.
- `withdraw()` — pull-pattern payout of any owed balance via
  `gl.chain.Account(who).emit_transfer(amount)`.
- Views: `get_grant`, `get_milestone`, `get_withdrawable`, `total_grants`.

## Repo structure

```
grantguard/
├── contracts/
│   ├── grantguard.py     # the Intelligent Contract
│   └── storage_test.py   # minimal sanity contract — deploy FIRST
├── frontend/
│   ├── index.html        # standalone dApp
│   ├── src/main.ts       # UI wiring
│   ├── src/lib/genlayer.ts
│   ├── scripts/verify_live.mjs   # wallet-free live smoke test
│   ├── tsconfig.json
│   ├── package.json
│   └── .env.example
├── tests/
│   └── test_grantguard.py     # gltest edge-case suite (deterministic paths)
├── scripts/
│   └── deploy.md              # deploy + seed procedure
├── ARCHITECTURE.md
├── CHANGELOG.md
└── README.md
```

## Run the frontend

```bash
cd frontend
cp .env.example .env    # only if you're pointing at a different address
npm install
npm run dev             # local dev server
npm run build           # tsc typecheck + vite production build
npm run verify:live     # wallet-free smoke test against studionet
```

Reads work immediately against the studionet RPC. Writes require MetaMask
(or another EIP-1193 wallet) on the GenLayer Studio Network, funded with GEN
from the Studio **Accounts** panel. The wallet is switched to studionet
automatically on connect via genlayer-js's `client.connect(NETWORK)`.

## Deploy the contract

See [`scripts/deploy.md`](scripts/deploy.md). Deploy `storage_test.py` first,
confirm `Result: SUCCESS`, then deploy `grantguard.py`.

## Test the contract

Deterministic edge cases (state machine, deposit accounting, guard clauses)
run under [gltest](https://pypi.org/project/genlayer-test/):

```bash
pip install genlayer-test
gltest --network localnet   # fastest
gltest --network studionet  # against the real hosted chain
```

The AI-dependent path (`review_milestone`) is a separate integration harness
that installs `sim_installMocks` before each transaction; it is not part of
the pytest edge-case suite, because a live LLM call is non-deterministic by
design.
