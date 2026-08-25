# v0.2.16
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *

import json

# ============================================================================
# GRANTGUARD — Milestone-based grant disbursement, judged on-chain
# ----------------------------------------------------------------------------
# A funder locks money for a grant split into milestones. Each milestone has a
# text deliverable and a payout. The grantee submits an evidence URL for a
# milestone; the Intelligent Contract READS that page from the live web and an
# LLM judges whether the deliverable was genuinely met "in spirit" before the
# tranche is released. No blind disbursement, no human grant officer.
#
# WHY THIS CANNOT BE A SOLIDITY CONTRACT:
#   Solidity cannot open a transcript / paper / repo, read it, and form a
#   subjective judgment that a qualitative milestone was actually achieved.
#   GrantGuard's release decision is exactly that judgment, executed on-chain
#   via web.render + exec_prompt under validator consensus.
# ============================================================================

# Milestone status (small ints to stay storage-safe).
MS_LOCKED = u8(0)      # funded, no submission yet
MS_SUBMITTED = u8(1)   # evidence submitted, awaiting review
MS_RELEASED = u8(2)    # AI approved -> tranche paid to grantee
MS_REJECTED = u8(3)    # AI rejected -> grantee may resubmit

# Grant status.
G_OPEN = u8(0)         # active
G_COMPLETE = u8(1)     # all milestones released
G_CANCELLED = u8(2)    # cancelled by funder (only before any submission)

# Threshold below which an APPROVE verdict is downgraded to REJECT: we would
# rather ask the grantee to strengthen the evidence than release funds on a
# hesitant judgment. Also used as the "escalate to strict re-review" cutoff.
MIN_APPROVAL_CONFIDENCE = u256(60)


class Contract(gl.Contract):
    # ----- grant-level storage (parallel TreeMaps keyed by grant_id) --------
    # Parallel maps are used instead of a single nested storage struct: the
    # struct-of-storage-typed-fields path in v0.2.16 requires an explicit
    # `gl.storage.inmem_allocate(...)` at construction, which complicates the
    # `create_grant()` payable path. Parallel maps are a plain, storage-safe
    # equivalent with no schema-generator sharp edges.
    grant_count: u256

    funder: TreeMap[u256, Address]
    grantee: TreeMap[u256, Address]
    grant_title: TreeMap[u256, str]
    grant_status: TreeMap[u256, u8]

    locked_balance: TreeMap[u256, u256]   # funds still held for this grant
    milestone_count: TreeMap[u256, u256]  # number of milestones in this grant

    # ----- milestone-level storage (keyed by a composite "grant:index" str) -
    ms_description: TreeMap[str, str]
    ms_payout: TreeMap[str, u256]
    ms_status: TreeMap[str, u8]
    ms_evidence_url: TreeMap[str, str]
    ms_reason: TreeMap[str, str]          # AI explanation of last decision
    ms_confidence: TreeMap[str, u256]

    # ----- pull-withdrawal ledger -------------------------------------------
    withdrawable: TreeMap[Address, u256]

    def __init__(self):
        # Only scalars assigned here. TreeMaps auto-init to empty.
        self.grant_count = u256(0)

    # ======================================================================
    # CREATE GRANT  (funder locks the full amount up-front)
    # ======================================================================
    @gl.public.write.payable
    def create_grant(
        self,
        title: str,
        grantee_addr: Address,
        milestone_descriptions: DynArray[str],
        milestone_payouts: DynArray[u256],
    ) -> u256:
        deposited = gl.message.value
        if len(title) == 0:
            raise Exception("Grant title required")
        if len(milestone_descriptions) == 0:
            raise Exception("At least one milestone required")
        if len(milestone_descriptions) != len(milestone_payouts):
            raise Exception("Descriptions and payouts length mismatch")

        # The deposit must exactly cover the sum of milestone payouts.
        total = u256(0)
        i = 0
        while i < len(milestone_payouts):
            p = milestone_payouts[i]
            if p == u256(0):
                raise Exception("Milestone payout must be greater than zero")
            total = total + p
            i = i + 1
        if deposited != total:
            raise Exception("Deposit must equal the sum of milestone payouts")

        grant_id = self.grant_count
        self.grant_count = self.grant_count + u256(1)

        funder_addr = gl.message.sender_address
        if grantee_addr == funder_addr:
            raise Exception("Funder cannot be the grantee")

        self.funder[grant_id] = funder_addr
        self.grantee[grant_id] = grantee_addr
        self.grant_title[grant_id] = title
        self.grant_status[grant_id] = G_OPEN
        self.locked_balance[grant_id] = deposited
        self.milestone_count[grant_id] = u256(len(milestone_descriptions))

        j = 0
        while j < len(milestone_descriptions):
            key = self._mkey(grant_id, u256(j))
            self.ms_description[key] = milestone_descriptions[j]
            self.ms_payout[key] = milestone_payouts[j]
            self.ms_status[key] = MS_LOCKED
            j = j + 1

        return grant_id

    # ======================================================================
    # SUBMIT EVIDENCE  (grantee attaches a URL for one milestone)
    # ======================================================================
    @gl.public.write
    def submit_milestone(self, grant_id: u256, milestone_index: u256, evidence_url: str) -> None:
        self._require_grant(grant_id)
        if self.grant_status[grant_id] != G_OPEN:
            raise Exception("Grant is not open")
        if gl.message.sender_address != self.grantee[grant_id]:
            raise Exception("Only the grantee can submit evidence")
        if milestone_index >= self.milestone_count[grant_id]:
            raise Exception("Milestone index out of range")
        if len(evidence_url) == 0:
            raise Exception("Evidence URL required")

        key = self._mkey(grant_id, milestone_index)
        st = self.ms_status[key]
        if st == MS_RELEASED:
            raise Exception("Milestone already released")
        if st == MS_SUBMITTED:
            raise Exception("Milestone already awaiting review")

        self.ms_evidence_url[key] = evidence_url
        self.ms_status[key] = MS_SUBMITTED

    # ======================================================================
    # REVIEW  (runs the non-deterministic AI judgment, releases or rejects)
    # ======================================================================
    @gl.public.write
    def review_milestone(self, grant_id: u256, milestone_index: u256) -> None:
        self._require_grant(grant_id)
        if self.grant_status[grant_id] != G_OPEN:
            raise Exception("Grant is not open")
        if milestone_index >= self.milestone_count[grant_id]:
            raise Exception("Milestone index out of range")

        key = self._mkey(grant_id, milestone_index)
        if self.ms_status[key] != MS_SUBMITTED:
            raise Exception("Milestone is not awaiting review")

        description = self.ms_description[key]
        url = self.ms_evidence_url[key]

        # ---- the core non-deterministic judgment ----
        raw = self._judge_milestone(description, url)

        approved = False
        reason = "Could not parse a valid decision."
        confidence = u256(0)
        try:
            parsed = json.loads(raw)
            verdict = str(parsed.get("verdict", "REJECT")).upper()
            approved = (verdict == "APPROVE")
            reason = str(parsed.get("reason", ""))
            conf_int = int(parsed.get("confidence", 0))
            if conf_int < 0:
                conf_int = 0
            if conf_int > 100:
                conf_int = 100
            confidence = u256(conf_int)
        except Exception:
            approved = False
            reason = "Malformed decision JSON; defaulting to REJECT (no funds moved)."
            confidence = u256(0)

        # Guard: an APPROVE with weak confidence is treated as REJECT. This is
        # the difference between "the reviewer is sure enough to move money"
        # and "the reviewer is only half-convinced" — we would rather ask the
        # grantee to strengthen the evidence than release funds on a hunch.
        if approved and confidence < MIN_APPROVAL_CONFIDENCE:
            approved = False
            reason = (
                "AI verdict was APPROVE but confidence (" + str(int(confidence)) +
                "/100) was below the release threshold (" +
                str(int(MIN_APPROVAL_CONFIDENCE)) +
                "). Strengthen the evidence and resubmit. Original reason: " +
                reason
            )

        self.ms_reason[key] = reason
        self.ms_confidence[key] = confidence

        if approved:
            payout = self.ms_payout[key]
            locked = self.locked_balance[grant_id]
            # Safety: never pay more than what remains locked.
            if payout > locked:
                payout = locked
            self.locked_balance[grant_id] = locked - payout
            self._credit(self.grantee[grant_id], payout)
            self.ms_status[key] = MS_RELEASED
            self._maybe_complete(grant_id)
        else:
            # Rejected: grantee may resubmit with better evidence.
            self.ms_status[key] = MS_REJECTED

    # ======================================================================
    # CANCEL  (funder reclaims locked funds — only before any submission)
    # ======================================================================
    @gl.public.write
    def cancel_grant(self, grant_id: u256) -> None:
        self._require_grant(grant_id)
        if gl.message.sender_address != self.funder[grant_id]:
            raise Exception("Only the funder can cancel")
        if self.grant_status[grant_id] != G_OPEN:
            raise Exception("Grant is not open")

        # Disallow cancellation if any milestone has been submitted/decided.
        count = self.milestone_count[grant_id]
        i = u256(0)
        while i < count:
            key = self._mkey(grant_id, i)
            if self.ms_status[key] != MS_LOCKED:
                raise Exception("Cannot cancel after a submission has been made")
            i = i + u256(1)

        refund = self.locked_balance[grant_id]
        self.locked_balance[grant_id] = u256(0)
        self._credit(self.funder[grant_id], refund)
        self.grant_status[grant_id] = G_CANCELLED

    # ======================================================================
    # WITHDRAW  (pull pattern)
    # ======================================================================
    @gl.public.write
    def withdraw(self) -> None:
        who = gl.message.sender_address
        amount = u256(0)
        if who in self.withdrawable:
            amount = self.withdrawable[who]
        if amount == u256(0):
            raise Exception("Nothing to withdraw")
        # Effects-before-interactions: zero the ledger BEFORE the transfer,
        # so a re-entering call sees nothing to pull.
        self.withdrawable[who] = u256(0)
        gl.chain.Account(who).emit_transfer(amount)

    # ======================================================================
    # VIEWS
    # ======================================================================
    @gl.public.view
    def get_grant(self, grant_id: u256) -> str:
        if grant_id not in self.grant_status:
            return "{}"
        out = {
            "id": int(grant_id),
            "title": self._gstr(self.grant_title, grant_id),
            "status": int(self.grant_status[grant_id]),
            "funder": self._gaddr(self.funder, grant_id),
            "grantee": self._gaddr(self.grantee, grant_id),
            "locked_balance": self._gint(self.locked_balance, grant_id),
            "milestone_count": self._gint(self.milestone_count, grant_id),
        }
        return json.dumps(out)

    @gl.public.view
    def get_milestone(self, grant_id: u256, milestone_index: u256) -> str:
        key = self._mkey(grant_id, milestone_index)
        if key not in self.ms_status:
            return "{}"
        out = {
            "grant_id": int(grant_id),
            "index": int(milestone_index),
            "description": self._mstr(self.ms_description, key),
            "payout": self._mint(self.ms_payout, key),
            "status": int(self.ms_status[key]),
            "evidence_url": self._mstr(self.ms_evidence_url, key),
            "reason": self._mstr(self.ms_reason, key),
            "confidence": self._mint(self.ms_confidence, key),
        }
        return json.dumps(out)

    @gl.public.view
    def get_withdrawable(self, who: Address) -> u256:
        if who in self.withdrawable:
            return self.withdrawable[who]
        return u256(0)

    @gl.public.view
    def total_grants(self) -> u256:
        return self.grant_count

    # ======================================================================
    # INTERNAL — non-deterministic milestone judgment
    # ======================================================================
    def _judge_milestone(self, description: str, evidence_url: str) -> str:
        def run() -> str:
            # Read the evidence page live from the web, on-chain.
            evidence = gl.nondet.web.render(evidence_url, mode="text")

            task = f"""You are an impartial grant reviewer deciding whether a funded
milestone has been genuinely completed before its payment is released.

MILESTONE DELIVERABLE (what the grantee committed to):
{description}

EVIDENCE PAGE CONTENT submitted by the grantee:
---
{evidence}
---

Judge whether the evidence genuinely demonstrates that the milestone was met
IN SPIRIT, not just superficially. Be skeptical of:
- empty / unreachable pages, or pages unrelated to the deliverable
- vague claims with no concrete proof
- evidence that addresses something other than what was promised

If the evidence is missing, unreachable, or clearly insufficient, you MUST
return "REJECT".

Respond with ONLY a JSON object, no surrounding prose:
{{"verdict": "APPROVE" | "REJECT",
  "confidence": <integer 0-100>,
  "reason": "<one or two sentence explanation>"}}"""
            return gl.nondet.exec_prompt(task, response_format="json")

        # Consensus on the MEANING of the decision: verdict must MATCH across
        # validators and confidence must be within 15 points; the free-form
        # `reason` text is deliberately allowed to vary. Two validators that
        # write different rationales still pass; two validators that reach
        # opposite verdicts do NOT — which is the whole point.
        # `prompt_comparative(fn, principle, /)` is positional-only, so both
        # arguments are passed positionally.
        return gl.eq_principle.prompt_comparative(
            run,
            (
                "The `verdict` field must be identical across the two answers "
                "(APPROVE vs REJECT). The `confidence` integers must be within "
                "15 points of each other. The `reason` text is free-form and "
                "does not need to match."
            ),
        )

    # ======================================================================
    # INTERNAL — helpers
    # ======================================================================
    def _maybe_complete(self, grant_id: u256) -> None:
        count = self.milestone_count[grant_id]
        i = u256(0)
        while i < count:
            key = self._mkey(grant_id, i)
            if self.ms_status[key] != MS_RELEASED:
                return
            i = i + u256(1)
        self.grant_status[grant_id] = G_COMPLETE

    def _credit(self, who: Address, amount: u256) -> None:
        current = u256(0)
        if who in self.withdrawable:
            current = self.withdrawable[who]
        self.withdrawable[who] = current + amount

    def _mkey(self, grant_id: u256, milestone_index: u256) -> str:
        # Composite key "grant:index" for milestone-level maps.
        return str(int(grant_id)) + ":" + str(int(milestone_index))

    def _require_grant(self, grant_id: u256) -> None:
        if grant_id not in self.grant_status:
            raise Exception("Grant does not exist")

    # ---- safe-read helpers ----
    def _gstr(self, m: TreeMap[u256, str], k: u256) -> str:
        if k in m:
            return m[k]
        return ""

    def _gint(self, m: TreeMap[u256, u256], k: u256) -> int:
        if k in m:
            return int(m[k])
        return 0

    def _gaddr(self, m: TreeMap[u256, Address], k: u256) -> str:
        if k in m:
            a = m[k]
            return a.as_hex if hasattr(a, "as_hex") else str(a)
        return ""

    def _mstr(self, m: TreeMap[str, str], k: str) -> str:
        if k in m:
            return m[k]
        return ""

    def _mint(self, m: TreeMap[str, u256], k: str) -> int:
        if k in m:
            return int(m[k])
        return 0
