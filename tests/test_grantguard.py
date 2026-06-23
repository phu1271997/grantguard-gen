"""
Tests for the GrantGuard contract.

NOTE: These target the GenLayer test harness (gltest / genlayer test runner).
The exact import path and helper API are NOT verified here — wire them to your
installed GenLayer tooling.

    # TODO: verify GenLayer test framework import + API.
    # e.g. from genlayer_test import deploy_contract, get_accounts

Coverage (maps to rubric edge cases):
  - deposit must equal sum of milestone payouts
  - zero payout rejected
  - funder cannot be grantee
  - only grantee can submit; only funder can cancel
  - cannot cancel after a submission
  - double-submit / review-when-not-submitted rejected
  - happy path: APPROVE releases a tranche; all approved -> grant COMPLETE
  - REJECT path: no funds move, grantee can resubmit
  - dead URL -> REJECT (run on testnet)
"""

import json
import pytest

# from genlayer_test import deploy_contract, get_accounts  # TODO: verify

CONTRACT_PATH = "contracts/grantguard.py"


@pytest.mark.skip(reason="Wire up GenLayer test harness (TODO: verify API)")
def test_deposit_must_equal_sum():
    c, acc = _deploy()
    with pytest.raises(Exception):
        c.create_grant("G", acc[1], ["m1", "m2"], [50, 50], value=80, sender=acc[0])


@pytest.mark.skip(reason="Wire up GenLayer test harness (TODO: verify API)")
def test_zero_payout_rejected():
    c, acc = _deploy()
    with pytest.raises(Exception):
        c.create_grant("G", acc[1], ["m1"], [0], value=0, sender=acc[0])


@pytest.mark.skip(reason="Wire up GenLayer test harness (TODO: verify API)")
def test_funder_cannot_be_grantee():
    c, acc = _deploy()
    with pytest.raises(Exception):
        c.create_grant("G", acc[0], ["m1"], [50], value=50, sender=acc[0])


@pytest.mark.skip(reason="Wire up GenLayer test harness (TODO: verify API)")
def test_only_grantee_can_submit():
    c, acc = _deploy()
    gid = c.create_grant("G", acc[1], ["m1"], [50], value=50, sender=acc[0])
    with pytest.raises(Exception):
        c.submit_milestone(gid, 0, "https://example.com/p", sender=acc[2])


@pytest.mark.skip(reason="Wire up GenLayer test harness (TODO: verify API)")
def test_cannot_cancel_after_submission():
    c, acc = _deploy()
    gid = c.create_grant("G", acc[1], ["m1"], [50], value=50, sender=acc[0])
    c.submit_milestone(gid, 0, "https://example.com/p", sender=acc[1])
    with pytest.raises(Exception):
        c.cancel_grant(gid, sender=acc[0])


@pytest.mark.skip(reason="Wire up GenLayer test harness (TODO: verify API)")
def test_review_requires_submission():
    c, acc = _deploy()
    gid = c.create_grant("G", acc[1], ["m1"], [50], value=50, sender=acc[0])
    with pytest.raises(Exception):
        c.review_milestone(gid, 0, sender=acc[0])


# --- AI-dependent (run on testnet) ---

@pytest.mark.skip(reason="Run on testnet; AI + web access required")
def test_dead_url_rejects_no_funds_move():
    c, acc = _deploy()
    gid = c.create_grant("G", acc[1], ["Publish dataset"], [50], value=50, sender=acc[0])
    c.submit_milestone(gid, 0, "https://nope-grantguard.invalid/x", sender=acc[1])
    c.review_milestone(gid, 0, sender=acc[0])
    ms = json.loads(c.get_milestone(gid, 0))
    assert ms["status"] == 3  # REJECTED
    assert c.get_withdrawable(acc[1]) == 0


@pytest.mark.skip(reason="Run on testnet; AI + web access required")
def test_happy_path_release_and_complete():
    c, acc = _deploy()
    gid = c.create_grant("G", acc[1], ["Publish dataset v1"], [50], value=50, sender=acc[0])
    c.submit_milestone(gid, 0, "https://real-evidence.example/dataset", sender=acc[1])
    c.review_milestone(gid, 0, sender=acc[0])
    grant = json.loads(c.get_grant(gid))
    ms = json.loads(c.get_milestone(gid, 0))
    if ms["status"] == 2:  # RELEASED
        assert grant["status"] == 1  # COMPLETE (single milestone)
        assert c.get_withdrawable(acc[1]) == 50


def _deploy():
    # TODO: verify — replace with real GenLayer deploy + accounts helpers.
    raise NotImplementedError("Wire up GenLayer test harness")
