"""Validate #3 documents and fictional examples, never production authorization.

The matrix and lifecycle tables are the rulebook. This small, deliberately bounded
fixture interpreter checks their consistency; it is not importable application RBAC,
a state service, a real HTTP test, or evidence of PostgreSQL isolation.
"""
from datetime import datetime, time, timedelta, timezone
import json
from pathlib import Path
import re
from uuid import UUID
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs/architecture"
ROLES = ["org_admin", "franchise_admin", "operator", "dispatcher", "delivery_agent", "accountant", "read_only"]


def rows(text, prefix):
    result = {}
    for line in text.splitlines():
        if re.match(rf"\| {prefix}\d+ \|", line):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            assert cells[0] not in result, f"Duplicate row {cells[0]}"
            result[cells[0]] = cells
    return result


def validate():
    matrix = (DOCS / "authorization-contract.md").read_text()
    headers = [line for line in matrix.splitlines() if line.startswith("| ID |") ]
    assert len(headers) == 3
    for header in headers:
        assert [c.strip() for c in header.strip("|").split("|")][2:] == ROLES
    rules = {}
    for prefix, count in [("R", 30), ("E", 4), ("W", 36)]:
        found = rows(matrix, prefix)
        assert set(found) == {f"{prefix}{i:02}" for i in range(1, count + 1)}
        rules.update(found)
    for key, row in rules.items():
        assert len(row) == 9, f"Seven roles required: {key}"
        for cell in row[2:]:
            assert set(cell.split(",")) <= {"-", "F", "C", "A", "G", "O", "V", "S", "P"}, (key, cell)
        if key[0] in "EW":
            assert row[-1] == "-", f"read_only mutation/export: {key}"
            assert row[2] == "-" or key in {"W31", "W33"}, f"org_admin operational grant: {key}"
    assert rules["E03"][7] == "F"
    assert all(rules[key][7] == "-" for key in ["E01", "E02", "E04"])
    assert rules["W02"][2:] == ["-", "F", "F", "F", "-", "-", "-"]
    assert rules["W08"][2:] == ["-", "F,C", "F,C", "F,C", "-", "-", "-"]
    assert rules["W16"][2:] == ["-", "C", "-", "-", "G", "-", "-"]
    assert rules["R05"][2:] == ["V", "F", "F", "-", "-", "-", "-"]
    assert rules["R07"][6] == "A"

    fixture = json.loads((DOCS / "fixtures/domain-contract.json").read_text())
    assert fixture["synthetic_only"] is True
    assert set(fixture["organizations"]) == {"A", "B"}
    assert set(fixture["franchises"]) == {"A1", "A2", "B1"}
    ids = list(fixture["organizations"].values())
    ids += [v["id"] for v in fixture["franchises"].values()]
    ids += [v["id"] for v in fixture["resources"].values()]
    assert len(ids) == len(set(ids))
    for value in ids:
        assert UUID(value).version == 4
    parcels = [v for v in fixture["resources"].values() if v["kind"] == "parcel"]
    dockets = [v["docket"] for v in parcels]
    assert len(dockets) == len(set(dockets))
    assert all(d.startswith("SYN-SHIPIT-") for d in dockets)
    assert sum(p["booking"] == "bk1" for p in parcels) == 2
    for p in parcels:
        parent = fixture["resources"][p["booking"]]
        assert (p["org"], p["franchise"]) == (parent["org"], parent["franchise"])
        assert fixture["franchises"][p["custodian"]]["org"] == p["org"]

    def scopes(case, resource, rule):
        """Interpret only documented scope cells for these synthetic object cases."""
        if not resource or not case.get("membership", True) or case["org"] != resource["org"]:
            return set()
        available = {"O"}
        if case.get("verification"):
            available.add("V")
        if case["franchise"] == resource["franchise"]:
            available.add("F")
        if case["franchise"] == resource.get("custodian"):
            available.add("C")
        if case["actor"] == resource.get("agent") and case["franchise"] == resource.get("custodian"):
            available.add("A")
            if case.get("transfer_grant"):
                available.add("G")
        # S/P are outside this object interpreter; adoption predicates are checked below.
        cells = set(rules[rule][2 + ROLES.index(case["role"])].split(","))
        return available & cells

    scenarios = (DOCS / "domain-scenarios.md").read_text()
    assert len(fixture["access_cases"]) == 28
    for case in fixture["access_cases"]:
        resource = fixture["resources"].get(case["resource"])
        grant = scopes(case, resource, case["rule"])
        if not case.get("authenticated", True):
            status = 401
        elif not scopes(case, resource, case["visibility_rule"]):
            status = 404
        elif not grant:
            status = 403
        else:
            status = 200
        projection = "none"
        if status == 200:
            if case["rule"].startswith("W"):
                projection = "command"
            elif case["role"] == "accountant":
                projection = "finance"
            elif "A" in grant:
                projection = "delivery"
            elif "V" in grant:
                projection = "verification"
            elif "O" in grant:
                projection = "organization_audit"
            elif case["role"] == "read_only":
                projection = "basic_shipment" if "C" in grant else "basic_booking"
            elif "C" in grant and "F" not in grant:
                projection = "shipment"
            else:
                projection = "own_franchise"
        assert (status, projection) == (case["expected_status"], case["expected_projection"]), case["id"]
        assert f"| {case['id']} | {case['description']} | {case['rule']} | {status} / {projection} |" in scenarios
        if case.get("lookup", "").startswith("SYN-SHIPIT-"):
            assert resource["docket"] == case["lookup"]

    lifecycle = (DOCS / "parcel-lifecycle.md").read_text()
    transitions = rows(lifecycle, "T")
    # Exact edges and role mapping detect an accidental generic rewind or broadened actor.
    expected = [
        ("none", "booked", "operator, dispatcher, franchise_admin"),
        ("booked", "checked_in", "operator"),
        ("checked_in", "dispatched", "operator, dispatcher, franchise_admin"),
        ("dispatched", "in_transit", "dispatcher"),
        ("in_transit", "out_for_delivery", "dispatcher"),
        ("out_for_delivery", "delivered", "delivery_agent"),
        ("out_for_delivery", "failed_attempt", "delivery_agent"),
        ("failed_attempt", "out_for_delivery", "dispatcher"),
        ("failed_attempt", "held_at_office", "operator"),
        ("held_at_office", "delivered", "delivery_agent"),
        ("failed_attempt", "rto", "franchise_admin"),
        ("held_at_office", "rto", "franchise_admin"),
        ("delivered", "held_at_office", "franchise_admin"),
    ]
    assert set(transitions) == {f"T{i:02}" for i in range(1, 14)}
    for i, edge in enumerate(expected, 1):
        row = transitions[f"T{i:02}"]
        assert len(row) == 10 and all(row)
        assert tuple(row[2:5]) == edge, row[0]
        assert row[7].startswith(("R0", "R1")), row[0]
    for text in ["customer_unavailable", "customer_requests_pickup", "address_issue", "recipient_refusal", "payment_not_collected", "operational_issue", "other_controlled"]:
        assert f"| {text} |" in lifecycle
    store = (ROOT / "apps/web/src/data/store.ts").read_text()
    old_reasons = re.search(r"FAILURE_REASONS: string\[\] = \[(.*?)\];", store, re.S).group(1)
    for reason in re.findall(r"'([^']+)'", old_reasons):
        assert reason in lifecycle, f"Unmapped prototype reason: {reason}"
    types = (ROOT / "apps/web/src/data/types.ts").read_text()
    booking = re.search(r"export interface Booking \{(.*?)\n\}", types, re.S).group(1)
    mapping = (DOCS / "prototype-domain-mapping.md").read_text()
    mapped_fields = set()
    for line in mapping.splitlines():
        if line.startswith("| "):
            mapped_fields.update(re.findall(r"\b\w+\b", line.split("|")[1]))
    for field in re.findall(r"^  (\w+)\??:", booking, re.M):
        assert field in mapped_fields, f"Unmapped Booking field: {field}"

    for case in fixture["money_cases"]:
        rounded = ((case["paise"] + 50) // 100) * 100
        assert (rounded, rounded - case["paise"]) == (case["rounded"], case["adjustment"])
    for case in fixture["cancellation_cases"]:
        allowed = bool(case["children"]) and all(c["status"] in {"booked", "checked_in"} and not c["ever_moved"] for c in case["children"])
        assert allowed == case["allowed"], case["id"]
    ist = ZoneInfo("Asia/Kolkata")
    for case in fixture["hold_cases"]:
        assert case["open_weekdays"] and set(case["open_weekdays"]) <= set(range(7))
        assert len(case["holidays"]) < 366  # bound this synthetic calendar input
        date = datetime.fromisoformat(case["held_at"].replace("Z", "+00:00")).astimezone(ist).date()
        remaining = 2
        while remaining:
            date += timedelta(days=1)
            if date.weekday() in case["open_weekdays"] and date.isoformat() not in case["holidays"]:
                remaining -= 1
        deadline = datetime.combine(date + timedelta(days=1), time(), ist).astimezone(timezone.utc)
        assert deadline.isoformat().replace("+00:00", "Z") == case["deadline"]
    for case in fixture["hold_boundary_cases"]:
        now = datetime.fromisoformat(case["now"].replace("Z", "+00:00"))
        deadline = datetime.fromisoformat(case["deadline"].replace("Z", "+00:00"))
        assert (now < deadline) == case["collection_eligible"]
        assert (now >= deadline) == case["rto_time_eligible"]
    start = datetime(2026, 9, 7, tzinfo=ist).astimezone(timezone.utc)
    assert start.isoformat() == "2026-09-06T18:30:00+00:00"
    assert (start + timedelta(days=1)).isoformat() == "2026-09-07T18:30:00+00:00"
    for case in fixture["adoption_cases"]:
        eligible = case["franchise_approval"] and case["receiving_approval"] and not case["unresolved"] and case["same_plan"]
        assert eligible == case["eligible"], case["id"]
    print("Domain contract checks passed: 70 matrix rows, 28 synthetic access/projection cases, 13 closed transition rows/actors, all Booking fields and prototype failure reasons, global fixture dockets, money/date/cancellation/adoption examples. No production behavior tested.")


if __name__ == "__main__":
    validate()
