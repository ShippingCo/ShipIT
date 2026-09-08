"""Issue #8 documentary fixture interpreter, not a production tax/proof/privacy service.

Uses the existing planning runner and Python stdlib. No providers, customer data,
secrets, persistent domain state or application imports. Expected outcomes and
negative controls verify this bounded policy model, not live isolation/cryptography.
"""
from copy import deepcopy
from fractions import Fraction
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ARCH = ROOT / "docs/architecture"
ROLES = ["org_admin", "franchise_admin", "operator", "dispatcher",
         "delivery_agent", "accountant", "read_only"]
CLASSES = {"customer_profile_contact", "booking_shipment_snapshots", "finance_tax_receipts",
           "delivery_proof_evidence", "challenge_material", "audit_security_metadata",
           "messaging_provider_records", "attachments"}


def require(value, message):
    if not value:
        raise AssertionError(message)


def integer(value):
    require(type(value) is int, "Money and rates require exact integers")
    return value


def half_up(value):
    return (2 * value.numerator + value.denominator) // (2 * value.denominator)


def money(case):
    basis = integer(case["basis_paise"])
    require(basis >= 0, "Negative credit policy remains gated")
    if case["jurisdiction"] == "unknown":
        return {"outcome": "resolution_required", "confirmed": False}
    require(case["jurisdiction"] in {"intra", "inter"}, "Unsupported jurisdiction")
    exact = {}
    for key, pair in case["rates"].items():
        require(key.startswith("TEST_"), "Only synthetic rates permitted")
        n, d = map(integer, pair)
        require(n >= 0 and d > 0, "Rate bounds")
        exact[key] = Fraction(basis * n, d)
    if exact:
        require(set(exact) == ({"TEST_CGST", "TEST_SGST"} if case["jurisdiction"] == "intra"
                              else {"TEST_IGST"}), "Class/component mismatch")
    total = half_up(sum(exact.values(), Fraction()))
    components = {k: v.numerator // v.denominator for k, v in exact.items()}
    order = sorted(exact, key=lambda k: (-(exact[k] - components[k]), k))
    for k in order[:total - sum(components.values())]:
        components[k] += 1
    require(sum(components.values()) == total, "Component reconciliation")
    unrounded = basis + total
    final = ((unrounded + 50) // 100) * 100
    return {"components": components, "tax_paise": total, "unrounded_paise": unrounded,
            "adjustment_paise": final - unrounded, "final_paise": final}


def challenge(trace, policy):
    state = dict(failures=0, resends=0, version=1, expires_at=policy["validity_seconds"],
                 physical_attempts=1, secret_present=True, proof_method=None, settled=False)
    last_send = 0
    for step in trace["steps"]:
        now = integer(step["t"])
        if now >= state["expires_at"]:
            state["secret_present"] = False
        if step.get("foreign"):
            outcome = "foreign"
        elif state["proof_method"]:
            outcome = "consumed"
        elif state["failures"] >= policy["max_failures"]:
            outcome = "locked"
        elif step["action"] == "verify":
            if step["version"] != state["version"]:
                outcome = "superseded"
            elif now >= state["expires_at"]:
                outcome = "expired"
            elif step["correct"]:
                outcome = "completed"
                state.update(secret_present=False, proof_method="otp_verified")
            else:
                state["failures"] += 1
                outcome = "locked" if state["failures"] == policy["max_failures"] else "wrong"
                if outcome == "locked":
                    state["secret_present"] = False
        else:
            require(step["action"] in {"resend", "replace"}, "Unknown challenge operation")
            if step["action"] == "resend" and now >= state["expires_at"]:
                outcome = "expired"
            elif step["action"] == "replace" and now < state["expires_at"]:
                outcome = "replacement_not_required"
            elif now - last_send < policy["cooldown_seconds"]:
                outcome = "cooldown"
            elif state["resends"] >= policy["max_resends"]:
                outcome = "resend_limit"
            else:
                state["resends"] += 1
                last_send = now
                if step["action"] == "replace":
                    state["version"] += 1
                    state["expires_at"] = now + policy["validity_seconds"]
                    state["secret_present"] = True
                    outcome = "replaced"
                else:
                    outcome = "resent"
        require(outcome == step["expected"], f"{trace['id']} at {now}: {outcome}")
    require(state == trace["final"], f"{trace['id']} final state: {state}")


def allowed(case, matrix):
    if case["scope"] == "foreign":
        return False
    grants = set(matrix[case["action"]][ROLES.index(case["role"])].split(","))
    # 'custody' is an A2-owned parcel physically held by A1 with current assignment;
    # 'sibling' has no custody/assignment. Own and custody fixtures are responsible.
    scopes = {"own": {"F", "C", "A"}, "custody": {"C", "A"}, "sibling": set()}[case["scope"]]
    return bool(grants & scopes)


def validate(f):
    contract = (ARCH / "money-tax-proof-privacy-contract.md").read_text()
    for clause in ["10 minutes", "Maximum 5 failed verifications", "60-second cooldown",
                   "at most 3 resend messages", "W37", "W38", "W39", "W40",
                   "50) // 100", "253 + 252", "franchise_admin", "No employee",
                   "payment", "ShippingCo estimate"]:
        require(clause in contract, f"Missing owning contract clause: {clause}")
    require(half_up(Fraction(1001, 2)) == 501, "Fractional-paise tie rounds upward")
    require(f["synthetic_only"] is True and "not legally applicable" in f["rate_notice"], "Synthetic declaration")
    require(f["challenge_policy"] == dict(validity_seconds=600, max_failures=5,
                                         cooldown_seconds=60, max_resends=3), "Pilot policy drift")
    require({c["id"] for c in f["money_cases"]} == {f"M{i:02}" for i in range(1, 6)}, "Money coverage")
    for case in f["money_cases"]:
        require(money(case) == case["expected"], f"{case['id']} money outcome")
        # Input order must not select the odd paise winner.
        reordered = deepcopy(case)
        reordered["rates"] = dict(reversed(list(case["rates"].items())))
        require(money(reordered) == case["expected"], "Order-dependent allocation")
    require([c["unrounded_paise"] for c in f["rounding_boundaries"]] == [12549, 12550, 12551], "Boundary coverage")
    for case in f["rounding_boundaries"]:
        p = integer(case["unrounded_paise"])
        require(((p + 50) // 100) * 100 == case["final_paise"], "50 paise upward")
        require(case["final_paise"] - p == case["adjustment_paise"], "Explicit adjustment")

    cases = {c["id"]: c for c in f["money_cases"]}
    change = f["snapshot_case"]
    configs = deepcopy(f["tax_configs"])
    def confirm(at):
        eligible = [(version, cfg) for version, cfg in configs.items()
                    if cfg["effective_from"] <= at < cfg["effective_to"]]
        require(len(eligible) == 1, "Config gap/overlap blocks confirmation")
        version, cfg = eligible[0]
        result = money(dict(basis_paise=10101, jurisdiction="intra", rates=cfg["rates"]))
        return dict(booking_id=change["booking_id"], org="TEST_ORG_A", franchise="TEST_A1",
                    policy_version=version, config=deepcopy(cfg), jurisdiction="intra",
                    basis_paise=10101, approval_ref="TEST_TAX_APPROVAL", result=result)
    original = confirm(change["confirmed_at"])
    preserved = json.dumps(original, sort_keys=True)
    require(original["policy_version"] == change["old_version"], "Original policy selection")
    require(original["result"] == cases[change["old_case"]]["expected"], "Original charge")
    new = confirm(change["next_booking_at"])
    require(new["policy_version"] == change["new_version"], "New effective version selection")
    require(new["result"] == cases[change["new_case"]]["expected"], "New charge")
    # A mutable settings object must not be aliased into a confirmed snapshot.
    configs[change["old_version"]]["rates"].clear()
    require(json.dumps(original, sort_keys=True) == preserved and change["historical_unchanged"],
            "Historical booked snapshot changed")

    require({t["id"] for t in f["challenge_traces"]} == {f"C{i:02}" for i in range(1, 6)}, "Challenge coverage")
    for trace in f["challenge_traces"]:
        challenge(trace, f["challenge_policy"])
    matrix = {}
    for line in (ARCH / "authorization-contract.md").read_text().splitlines():
        if re.match(r"\| W\d+ \|", line):
            parts = [c.strip() for c in line.strip("|").split("|")]
            matrix[parts[0]] = parts[2:]
    required_cases = {(a, r, s) for a in ["W27", "W37", "W38", "W39", "W40", "W34"]
                      for r in ROLES for s in ["own", "sibling", "foreign", "custody"]}
    require({(c["action"], c["role"], c["scope"]) for c in f["scope_cases"]} == required_cases,
            "All seven roles and four scopes required")
    for case in f["scope_cases"]:
        require(allowed(case, matrix) == case["expected"], f"Scope outcome: {case}")
    require({c["id"] for c in f["exceptions"]} == {f"X{i:02}" for i in range(1, 6)}, "Exception coverage")
    for case in f["exceptions"]:
        permitted = (allowed(dict(action="W40", role=case["role"], scope=case["scope"]), matrix)
                     and case["requester"] != case["approver"] and case["present"]
                     and bool(case["evidence_ref"]) and case["reason"] in
                     {"recipient_channel_unavailable", "provider_unavailable", "challenge_locked_reviewed"})
        require(permitted == case["expected"], f"{case['id']} exceptional proof")
        if permitted:
            proof = dict(proof_method="exceptional", approving_actor=case["approver"],
                         approval_ref="TEST_APPROVAL", parcel_ref="TEST_PARCEL", attempt_ref="TEST_ATTEMPT",
                         occurred_at="2026-09-08T12:00:00Z", reason=case["reason"], evidence_ref=case["evidence_ref"])
            require(proof["proof_method"] != "otp_verified" and "settled" not in proof, "Proof cannot settle money")
    require(set(f["retention_classes"]) == CLASSES, "Retention class coverage")
    require({p["id"] for p in f["privacy_cases"]} == {"P01", "P02", "P03"}, "Privacy coverage")
    for case in f["privacy_cases"]:
        for field in case["fields"]:
            result = "retain" if any(field[k] for k in ["purpose_active", "mandatory_period_active", "hold"]) else "eligible"
            require(result == field["expected"], f"{case['id']} field eligibility")
    require({e["id"] for e in f["eway_cases"]} == {"E01", "E02"}, "E-way coverage")
    for case in f["eway_cases"]:
        if case["provenance"] == "shippingco_estimate":
            require(case["official_valid_until"] is None and "estimate" in case["label"], "Estimate misrepresented as official")
        else:
            require(case["provenance"] == "unverified_external" and case["source_ref"].startswith("TEST_")
                    and "unverified" in case["label"], "External evidence provenance")


def main():
    def unique(pairs):
        result = {}
        for k, v in pairs:
            require(k not in result, "Duplicate JSON key")
            result[k] = v
        return result
    def reject_fractional_json(_):
        raise AssertionError("Fixture numeric values must be exact integers")
    fixture = json.loads((ARCH / "fixtures/money-tax-proof-privacy.json").read_text(),
                         object_pairs_hook=unique, parse_float=reject_fractional_json,
                         parse_constant=reject_fractional_json)
    validate(fixture)
    mutations = [
        lambda f: f["money_cases"][1]["expected"]["components"].update(TEST_SGST=253),
        lambda f: f["money_cases"][4]["expected"].update(confirmed=True),
        lambda f: f["money_cases"][0].update(basis_paise=10101.0),
        lambda f: f["snapshot_case"].update(historical_unchanged=False),
        lambda f: f["snapshot_case"].update(next_booking_at="2026-09-08T23:59:59Z"),
        lambda f: f["challenge_policy"].update(max_failures=6),
        lambda f: f["challenge_traces"][0]["final"].update(expires_at=780),
        lambda f: f["challenge_traces"][1]["steps"][2].update(expected="completed"),
        lambda f: f["challenge_traces"][3]["final"].update(failures=4),
        lambda f: f["challenge_traces"][2]["final"].update(physical_attempts=5),
        lambda f: f["scope_cases"][0].update(expected=True),
        lambda f: f["exceptions"][1].update(expected=True),
        lambda f: f["exceptions"][3].update(expected=True),
        lambda f: f["retention_classes"].pop(),
        lambda f: f["privacy_cases"][0]["fields"][2].update(expected="eligible"),
        lambda f: f["eway_cases"][0].update(official_valid_until="2026-09-10T00:00:00Z"),
    ]
    for mutate in mutations:
        broken = deepcopy(fixture)
        mutate(broken)
        try:
            validate(broken)
        except (AssertionError, KeyError, ValueError, TypeError):
            continue
        raise AssertionError("Negative control unexpectedly accepted")
    print("Issue 8 policy checks passed: exact money/snapshots, 5 fake-clock traces, 168 role/scope cases, "
          "5 exception cases, 8 retention classes, 3 deletion cases, 2 e-way cases, 16 negative controls. "
          "No production behavior tested.")


if __name__ == "__main__":
    main()
