# GrantGuard — GenLayer Project Explorer Submission Draft

**Prepared:** 2026-08-25 · **Status:** DO NOT SUBMIT YET — see blockers below.

---

## ⛔ Blockers before you submit

| # | Blocker | Owner | Fix |
|---|---|---|---|
| B1 | **State is empty on-chain.** `total_grants = 0`. A reviewer would land on the app with nothing to click through. | You (needs a funded studionet wallet) | Seed three grants per the procedure below |
| B2 | **`grantguard-gen.vercel.app` is owned by another Vercel account.** The freshly built dApp is deployed under `grantguard-gen-drab.vercel.app`. Old URL still serves the pre-fix build. | You | Either (a) submit the `-drab` URL, or (b) log in to the other Vercel account that owns `grantguard-gen` and delete/rename that project, then reassign the alias here |

Ping me once B1 is done and you tell me which URL you want to publish, and I finalize the fields below.

---

## Seeding procedure (Blocker B1)

**Prerequisites**

- MetaMask on the GenLayer Studio Network. When you first connect on the live app, `genlayer-js` calls `wallet_addEthereumChain` for you — chainId `61999` (hex `0xF1EF`), RPC `https://studio.genlayer.com/api`, symbol `GEN`, 18 decimals.
- **Two funded studionet wallets:**
  - `FUNDER` — needs ≥ 30 GEN. Fund it from the Studio **Accounts** panel by transferring GEN from a pre-funded Studio account. Do **not** use `testnet-faucet.genlayer.foundation` — that faucet funds Bradbury/Asimov testnet, not studionet, and none of that GEN will show up here.
  - `GRANTEE` — needs ≥ 1 GEN, for gas on the `submit_milestone` / `withdraw` calls.

**Grant A — happy path (APPROVE, ends RELEASED)**

1. Connect FUNDER on the live app.
2. Title: `Open dataset — Phase 1`. Grantee: `<GRANTEE address>`. One milestone: `Publish v1 with a readme`, payout `10 GEN`. Click **Lock funds & create grant**.
3. Reconnect GRANTEE. On the loaded grant, submit an evidence URL that clearly satisfies the deliverable — e.g. a public GitHub README that describes the dataset. Click **Submit evidence**.
4. Anyone: click **Request AI review**. Wait for consensus. Expect status → **RELEASED**, a release-green rail, confidence ≥ 60, a `reason` line, and a Withdraw button showing 10 GEN.

**Grant B — reject path (REJECTED, no funds moved)**

1. Same funder / grantee. Title: `Bug bounty writeup`. Milestone: `Public writeup of CVE-YYYY-nnnn`, payout `5 GEN`.
2. Submit an obviously off-topic evidence URL — a homepage, an empty gist, an unrelated blog post.
3. Request review. Expect status → **REJECTED**, a dark-red rail, a `reason` explaining the mismatch, and no Withdraw balance change.

**Grant C — completed multi-milestone**

1. Title: `Research report — Q1 milestones`. Two milestones, each with substantive evidence URLs, `7 GEN` + `5 GEN`.
2. Submit + approve both. Expect grant status → **COMPLETE**, and grantee has 12 GEN pending withdrawal (add to Grant A's balance if same account).

**Verify from the outside**

```bash
cd frontend
npm run verify:live
# → total_grants = 3
# → grant 0, 1, 2 readable
```

Then open the live app in an incognito window with no wallet connected, hit **Load grant record** on ids `0`, `1`, `2`, and confirm the AI verdict, confidence, and reason are all visible without signing anything. This is what the reviewer will do.

---

## Section 01 — Identity

### Logo

- SVG source: `frontend/public/logo.svg`
- PNG at 1024×1024: `frontend/public/logo-1024.png` (1.1 MB)
- PNG at 512×512: `frontend/public/logo-512.png` (296 KB, upload this — well under the 2 MB cap)

Concept: a shield silhouette (the "guard") wrapping a large check mark (the release). Palette matches the app's release-green accent so the browser tab, the app header, and the Portal card read as one identity.

### Project name

```
GrantGuard
```

### Primary category

```
Dispute Resolution
```

Reason: the whole contract is a judgment call — did the deliverable meet the milestone? — with money conditional on the outcome. That matches how GenLayer positions itself as an "adjudication layer" better than `AI & Agents`, which every catalog entry could pick and which offers no discovery signal. Not chosen: `AI & Agents` (too generic — no differentiation), `DeFi` (this is an escrow, not a market/lending product).

### Category tag 1 — the one every user hits

```
Evidence Assessment
```

Implementing function: `review_milestone(grant_id, milestone_index)` in `contracts/grantguard.py`. It calls `gl.nondet.web.render(evidence_url, mode="text")` on the grantee-supplied URL, then reasons over the page content with `gl.nondet.exec_prompt` before ruling APPROVE/REJECT.

### Category tag 2 — the optional branch

```
Escrow Claims
```

Implementing function: `create_grant(...)` (funder locks the exact sum of payouts up front) + `withdraw()` (grantee pulls the released tranches, paid via `gl.chain.Account(who).emit_transfer(amount)`) + `cancel_grant(grant_id)` (funder-only, only before any submission). Together this is a milestone-conditional 2-party escrow.

Rejected tags and why:
- `Moderation Appeals` — no takedown flow.
- `License Claims` — the contract never reads license terms.
- `Appeal Review` — REJECT lets the grantee resubmit, but there is no second-tier review over a prior verdict.
- `Jury Selection` — validator selection is GenLayer's, not the app's. Rubric explicitly says naming a UI "AI Jury" does not count.

---

## Section 02 — Project summary

### One-liner (`136 / 180` chars)

```
Milestone grants where an on-chain AI reviewer reads your proof URL and releases each tranche only if the deliverable was genuinely met.
```

### Description (`991 / 1000` chars)

```
GrantGuard is a milestone-based grant escrow judged on-chain by an AI reviewer.

What it does. A funder splits a grant into deliverables and locks the exact sum of milestone payouts up front. For each milestone the grantee submits a link as proof — a repo, a paper, a transcript. review_milestone() opens that URL with gl.nondet.web.render, hands the page and the deliverable to an LLM via gl.nondet.exec_prompt, and returns APPROVE or REJECT with a confidence and reason. Validators must agree on the verdict, and on confidence within 15 points, or consensus fails; free-form rationale can vary. An APPROVE below 60/100 is downgraded to REJECT. Payouts move via a pull-withdrawal ledger.

Who it is for. Grant programs, bounty pools, DAO treasuries, and scholarships that want conditional disbursement without a human grant officer or an off-chain oracle.

Why GenLayer. Solidity cannot open a page and judge whether a qualitative deliverable was met. That judgment is the whole contract.
```

---

## How to try it

**Prerequisites (free, read-only)**

- No wallet required to open the app and load an existing grant.
- Load grant `0`, `1`, or `2` to see three worked outcomes (APPROVE, REJECT, COMPLETE).

**Prerequisites (to run the whole flow)**

- MetaMask on the GenLayer Studio Network (auto-added on connect).
- A studionet-funded wallet with ≥ 15 GEN. Fund it from Studio → **Accounts**; the testnet faucet does not fund studionet.

**Step 1 — Look at an existing grant.**
Enter `0` in the "Open a grant" box and click **Load grant record**. The ledger shows a released tranche, the AI's `reason`, and its `confidence`. No wallet, no signing.

**Step 2 — Connect your wallet.**
Click **Connect wallet**. Approve the network switch to GenLayer Studio Network in MetaMask.

**Step 3 — Create a new grant.**
Fill "Grant title", a grantee address (a second wallet you control), and one or more milestones with GEN payouts. The **Lock funds** button locks the exact sum. Confirm the tx in MetaMask.

**Step 4 — Submit evidence as the grantee.**
Reconnect using your grantee wallet. Load the grant by its id, paste an evidence URL into the milestone row, and click **Submit evidence**.

**Step 5 — Request the AI review.**
Click **Request AI review**. The row shows a spinner while consensus is running (~30–90 s). The tx URL appears in the ledger notice — click it to see `GENVM RESULT: SUCCESS` on explorer-studio.

**Step 6 — Read the verdict.**
- APPROVE (confidence ≥ 60) → milestone RELEASED, Withdraw button shows the tranche in GEN. Click it to pull the funds.
- REJECT or low confidence → milestone REJECTED, `reason` explains what was missing. Update the URL and repeat step 4.

**Expected end state.** Grant A is RELEASED and its tranche has been withdrawn. Grant B is REJECTED. Grant C is COMPLETE.

**If something goes wrong.**
- "insufficient funds" on create → the connected account has no studionet GEN. Top up via Studio → Accounts (step 2).
- MetaMask `'from'` RPC error → wrong network selected. Reconnect the wallet; the app calls `wallet_switchEthereumChain` on connect.
- Review request stays in a spinner past ~2 minutes → the evidence URL might be behind auth or timing out. Try a public URL first.

---

## Expected verification outcome (`467 / 500` chars)

```
After submitting evidence and clicking "Request AI review", the milestone card shows either RELEASED (green rail) with the released amount added to the grantee's Withdraw button, or REJECTED (red rail) with an italic reason quoting the on-chain AI verdict and its confidence out of 100. The grant header's "released" total updates in the same step, and the transaction shows GENVM RESULT: SUCCESS on explorer-studio, proving the verdict came from validator consensus.
```

---

## Contract link

- Address: `0xACe566a3440c2A5f37c32616F1C59625ac8EA2B9`
- Network: **studionet**
- Status: **Preview** (studionet always maps to Preview on Explorer)
- Explorer page: <https://explorer-studio.genlayer.com/address/0xACe566a3440c2A5f37c32616F1C59625ac8EA2B9>
- Verified alive on 2026-08-25: `gen_getContractSchema` returns all nine methods; `total_grants = 0` before seeding.

Verification command anyone can run:

```bash
cd frontend && npm run verify:live
```

**Note about the deployed contract.** The address above was deployed before this session and is fully readable, but it was compiled from a source that contained two runtime bugs (see CHANGELOG 0.2.0). `withdraw()` and `review_milestone()` would both revert on their first real call. Every deterministic path (create/submit/cancel/views) works correctly. If you want the seed procedure above to actually succeed, redeploy `contracts/grantguard.py` from the current `main` branch on Studio and swap `VITE_GRANTGUARD_CONTRACT_ADDRESS` in `frontend/.env` for the new address before the frontend redeploy. Otherwise, do not submit — B1 cannot be satisfied on the current contract.

---

## Website

```
https://grantguard-gen-drab.vercel.app
```

(Swap in `https://grantguard-gen.vercel.app` once B2 is resolved.)

## GitHub

```
https://github.com/phu1271997/grantguard-gen
```

---

## Community links (optional)

Leave blank unless you have a public Discord/X/Telegram to point at.

---

## Pre-submission checklist

**Truthfulness**
- [ ] Every feature in the description is exercisable on the live URL right now
- [ ] Description does not mention features not built (`appeal_milestone`, multi-source cross-check, etc.)
- [ ] Status is set to **Preview** (matches studionet)
- [ ] `Evidence Assessment` and `Escrow Claims` both point at real functions in the contract

**Deploy state**
- [ ] Every commit on `main` is pushed (currently pushed through `15dc17d`)
- [ ] Vercel serves the latest build (check the JS asset hash in the HTML source)
- [ ] `gen_getContractSchema` returns all nine methods
- [ ] Explorer address page shows at least one `SUCCESS` / `Accepted` transaction

**End-to-end**
- [ ] Grant A (APPROVE + WITHDRAW), Grant B (REJECT), Grant C (COMPLETE) all seeded
- [ ] Load ids 0/1/2 in an incognito window with no wallet — verdict + reason + confidence visible
- [ ] Walked "How to try it" end-to-end on a fresh wallet, hit "Expected verification outcome"

**Limits**
- [ ] Logo uploaded is PNG under 2 MB (recommend `logo-512.png`)
- [ ] One-liner still ≤ 180 chars after any tweak
- [ ] Description still ≤ 1000 chars after any tweak
- [ ] Expected verification outcome still ≤ 500 chars after any tweak
- [ ] Either GitHub or Website (both here) filled in
