"""Validate Issue #6's synthetic environment and threat contract."""
from copy import deepcopy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCH = ROOT / "docs" / "architecture"
FIXTURE = ARCH / "fixtures" / "security-contract.json"
SECRET_WORDS = {"secret", "token", "password", "credential", "database_url", "signing", "private_key", "otp"}
REQUIRED_THREATS = {"tenant_idor", "forged_webhook", "webhook_replay", "otp_theft_guess_replay",
                    "sql_injection", "message_abuse", "session_theft", "secret_exposure",
                    "unsafe_private_upload", "audit_gap"}
REQUIRED_LOG_DENIALS = {"password", "access_token", "provider_token", "cookie",
                        "authorization_header", "otp", "otp_verifier", "otp_pepper",
                        "database_url", "signing_key", "private_key", "full_address",
                        "raw_provider_payload", "attachment_body", "carrier_credential", "secret_value"}
ROTATION = ["create", "overlap", "canary", "verify", "rollout", "disable_old",
            "observe", "revoke", "destroy"]


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def parse_unique(text):
    def pairs(items):
        result = {}
        for key, value in items:
            check(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs)


def rejected(fn):
    try:
        fn()
    except (AssertionError, KeyError, TypeError, ValueError):
        return
    raise AssertionError("Negative control was unexpectedly accepted")


def validate_environments(fixture):
    environments = fixture["environments"]
    check([item["name"] for item in environments] ==
          ["developer", "demo", "staging", "production"], "Environment catalog")
    for field in ("database_identity", "messaging_identity", "storage_identity"):
        values = [item[field] for item in environments]
        check(len(values) == len(set(values)), f"Shared {field}")
    demo = environments[1]
    check(demo["data"] == "synthetic_only" and not demo["production_access"], "Demo isolation")
    check("fake" in demo["messaging_identity"] and
          all("production" not in str(value) for value in demo.values()), "Demo provider isolation")
    check(environments[3]["production_access"] is True, "Production marker")


def validate_configuration(fixture):
    entries = fixture["configuration"]
    names = [item["name"] for item in entries]
    check(len(names) == len(set(names)), "Duplicate configuration name")
    check({item["class"] for item in entries} ==
          {"browser_public", "server_config", "secret_reference"}, "Configuration classes")
    for item in entries:
        name = item["name"]
        check(type(item["owner_issue"]) is int and item["owner_issue"] > 0, "Config owner")
        check(item["consumer"] in {"web", "api", "worker", "api_worker"}, "Config consumer")
        check(item["source"] in {"deployment_config", "build_metadata", "managed_secret_store"},
              "Config source")
        check(item["required_in"] and set(item["required_in"]) <=
              {"developer", "demo", "staging", "production"}, "Config environments")
        if name.startswith("VITE_"):
            check(item["class"] == "browser_public", "VITE value must be public")
        if item["class"] == "browser_public":
            check(not any(word in name.lower() for word in SECRET_WORDS), "Secret-like browser config")
        if item["class"] == "secret_reference":
            check(name.endswith("_REF"), "Secret must be a managed reference")
            check(item["source"] == "managed_secret_store" and item["consumer"] != "web",
                  "Secret source/consumer")
    docs = (ARCH / "configuration-contract.md").read_text()
    for item in entries:
        check(f"`{item['name']}`" in docs, f"Undocumented config: {item['name']}")


def validate_threats(fixture):
    threats = fixture["threats"]
    check({item["name"] for item in threats} == REQUIRED_THREATS, "Threat coverage")
    check([item["id"] for item in threats] == [f"T{i:02}" for i in range(1, 11)], "Threat IDs")
    allowed_stride = {"spoofing", "tampering", "repudiation", "information_disclosure",
                      "denial_of_service", "elevation"}
    for item in threats:
        check(item["stride"] in allowed_stride, "STRIDE category")
        check(item["controls"] and item["detection"] and item["verification"] and
              item["owner_issues"], "Threat evidence")
        check(all(type(owner) is int and owner > 0 for owner in item["owner_issues"]), "Threat owner")
        check(item["release_blocker"] is True and item["residual_risk"], "Threat release decision")
    docs = (ARCH / "security-threat-model.md").read_text()
    for item in threats:
        check(f"| {item['id']} |" in docs, f"Undocumented threat: {item['id']}")


def validate_response(fixture):
    check(REQUIRED_LOG_DENIALS <= set(fixture["prohibited_log_fields"]), "Incomplete prohibited-log list")
    check(fixture["rotation"]["phases"] == ROTATION, "Unsafe rotation order")
    failed = fixture["rotation"]["failed_rollout"]
    check("valid_old_version" in failed and "compromised" in failed, "Failed rollout rule")
    incident = fixture["incident"]["fake_leaked_whatsapp_token"]
    required = {"report_privately", "revoke", "pause_unsafe_sends", "replace", "canary",
                "investigate_safe_audit", "remove_exposure", "notify_owners", "add_prevention"}
    check(required <= set(incident) and incident.index("revoke") < incident.index("replace"),
          "Leak response")


def validate_fixture(fixture):
    check(fixture["synthetic_only"] is True, "Fixture must be synthetic")
    validate_environments(fixture)
    validate_configuration(fixture)
    validate_threats(fixture)
    validate_response(fixture)


def validate():
    fixture = parse_unique(FIXTURE.read_text())
    validate_fixture(fixture)
    broken = deepcopy(fixture)
    broken["environments"][1]["database_identity"] = broken["environments"][3]["database_identity"]
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["environments"][1]["production_access"] = True
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["configuration"][0]["name"] = "VITE_SESSION_TOKEN"
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["configuration"][7]["source"] = "deployment_config"
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["threats"][0]["verification"] = []
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["threats"][1]["owner_issues"] = []
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["threats"][2]["controls"] = []
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["threats"][3]["detection"] = []
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["prohibited_log_fields"].remove("full_address")
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["rotation"]["phases"].remove("overlap")
    rejected(lambda: validate_fixture(broken))
    broken = deepcopy(fixture); broken["rotation"]["failed_rollout"] = "continue"
    rejected(lambda: validate_fixture(broken))
    print("Security contract checks passed: isolation, config classes, 10 threats, logs, rotation and leak response.")


if __name__ == "__main__":
    validate()
