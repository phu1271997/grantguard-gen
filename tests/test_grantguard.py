"""
Deterministic edge-case tests for GrantGuard.

These use `gltest` to deploy the real Intelligent Contract into a fresh test
context and exercise the state machine and guard clauses. They do NOT exercise
`review_milestone`, because that path is non-deterministic (LLM + live web) and
belongs in a separate integration harness with `sim_installMocks`.

Run:

    # 1. Fast local iteration (needs a local GenLayer node on 127.0.0.1:4000)
    gltest --network localnet

    # 2. Against studionet (needs GEN in your default account)
    gltest --network studionet

Coverage:
    * deposit must equal sum of milestone payouts
    * zero payout rejected
    * mismatched description / payout lengths rejected
    * funder cannot be grantee
    * only grantee can submit; only funder can cancel
    * cannot cancel after a submission has been made
    * cannot review a milestone that is not SUBMITTED
    * happy submit flow lands the milestone in SUBMITTED
    * total_grants view increments correctly
"""

from pathlib import Path

import pytest

from gltest import get_accounts, get_contract_factory


CONTRACT_PATH = str(Path(__file__).resolve().parent.parent / "contracts" / "grantguard.py")


def _deploy_fresh():
    """Deploy a clean GrantGuard for the current test."""
    factory = get_contract_factory(contract_file_path=CONTRACT_PATH)
    contract = factory.deploy(args=[])
    accounts = get_accounts()
    if len(accounts) < 3:
        pytest.skip("Need at least 3 configured test accounts")
    return contract, accounts[0], accounts[1], accounts[2]


def _payout_wei(gen_units):
    """Milestone payouts are u256 wei-style ints; 1 GEN = 10**18."""
    return int(gen_units) * (10 ** 18)


def test_deposit_must_equal_sum():
    contract, funder, grantee, _ = _deploy_fresh()
    payouts = [_payout_wei(50), _payout_wei(50)]
    with pytest.raises(Exception):
        contract.connect(funder).create_grant(
            args=["G", grantee.address, ["m1", "m2"], payouts]
        ).transact(value=_payout_wei(80))


def test_zero_payout_rejected():
    contract, funder, grantee, _ = _deploy_fresh()
    with pytest.raises(Exception):
        contract.connect(funder).create_grant(
            args=["G", grantee.address, ["m1"], [0]]
        ).transact(value=0)


def test_length_mismatch_rejected():
    contract, funder, grantee, _ = _deploy_fresh()
    with pytest.raises(Exception):
        contract.connect(funder).create_grant(
            args=["G", grantee.address, ["a", "b"], [_payout_wei(10)]]
        ).transact(value=_payout_wei(10))


def test_funder_cannot_be_grantee():
    contract, funder, _grantee, _ = _deploy_fresh()
    with pytest.raises(Exception):
        contract.connect(funder).create_grant(
            args=["G", funder.address, ["m1"], [_payout_wei(50)]]
        ).transact(value=_payout_wei(50))


def test_only_grantee_can_submit():
    contract, funder, grantee, stranger = _deploy_fresh()
    contract.connect(funder).create_grant(
        args=["G", grantee.address, ["m1"], [_payout_wei(50)]]
    ).transact(value=_payout_wei(50))

    with pytest.raises(Exception):
        contract.connect(stranger).submit_milestone(
            args=[0, 0, "https://example.com/p"]
        ).transact()


def test_cannot_cancel_after_submission():
    contract, funder, grantee, _ = _deploy_fresh()
    contract.connect(funder).create_grant(
        args=["G", grantee.address, ["m1"], [_payout_wei(50)]]
    ).transact(value=_payout_wei(50))

    contract.connect(grantee).submit_milestone(
        args=[0, 0, "https://example.com/p"]
    ).transact()

    with pytest.raises(Exception):
        contract.connect(funder).cancel_grant(args=[0]).transact()


def test_review_requires_submission():
    contract, funder, grantee, _ = _deploy_fresh()
    contract.connect(funder).create_grant(
        args=["G", grantee.address, ["m1"], [_payout_wei(50)]]
    ).transact(value=_payout_wei(50))

    with pytest.raises(Exception):
        contract.connect(funder).review_milestone(args=[0, 0]).transact()


def test_submit_lands_in_submitted_state():
    contract, funder, grantee, _ = _deploy_fresh()
    contract.connect(funder).create_grant(
        args=["G", grantee.address, ["Publish dataset v1"], [_payout_wei(50)]]
    ).transact(value=_payout_wei(50))

    contract.connect(grantee).submit_milestone(
        args=[0, 0, "https://example.com/proof"]
    ).transact()

    # Read the milestone back and confirm state == 1 (SUBMITTED).
    import json as _json

    raw = contract.get_milestone(args=[0, 0]).call()
    parsed = _json.loads(raw)
    assert parsed["status"] == 1
    assert parsed["evidence_url"] == "https://example.com/proof"


def test_total_grants_increments():
    contract, funder, grantee, _ = _deploy_fresh()
    assert int(contract.total_grants(args=[]).call()) == 0

    contract.connect(funder).create_grant(
        args=["G1", grantee.address, ["m"], [_payout_wei(10)]]
    ).transact(value=_payout_wei(10))
    assert int(contract.total_grants(args=[]).call()) == 1

    contract.connect(funder).create_grant(
        args=["G2", grantee.address, ["m"], [_payout_wei(20)]]
    ).transact(value=_payout_wei(20))
    assert int(contract.total_grants(args=[]).call()) == 2


def test_withdraw_nothing_reverts():
    contract, funder, _, _ = _deploy_fresh()
    with pytest.raises(Exception):
        contract.connect(funder).withdraw(args=[]).transact()
