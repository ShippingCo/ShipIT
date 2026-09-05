"""Validate tracked planning contracts without adding a runtime dependency."""
from pathlib import Path
import re
ROOT = Path(__file__).resolve().parents[1]
required = ["CONTRIBUTING.md", "SECURITY.md", "docs/ROADMAP.md", "docs/ISSUE_INDEX.md", "docs/ENGINEERING_WORKFLOW.md", "docs/PROTOTYPE_TO_PRODUCTION.md", ".github/PULL_REQUEST_TEMPLATE.md", ".github/ISSUE_TEMPLATE/implementation.md", ".github/ISSUE_TEMPLATE/bug.md", ".github/ISSUE_TEMPLATE/research.md", ".github/ISSUE_TEMPLATE/security-infrastructure.md"]
for name in required:
    assert (ROOT / name).is_file(), f"Missing {name}"
roadmap = (ROOT / "docs/ROADMAP.md").read_text()
assert "Prototype v0 — completed before production milestones" in roadmap
assert "POST-MVP / FUTURE COMMERCIALIZATION" in roadmap
for m in range(9):
    assert f"M{m} —" in roadmap
workflow = (ROOT / "docs/ENGINEERING_WORKFLOW.md").read_text()
for text in ["git checkout main", "git pull origin main", "git checkout -b issue-", "git push -u origin", "Closes #", "After merge"]:
    assert text in workflow, f"Missing workflow step: {text}"
assert all(f"{n}. " in workflow for n in range(1, 18))
for name in required:
    content = (ROOT / name).read_text()
    assert content.count("```") % 2 == 0, f"Unclosed fence: {name}"
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
        if "://" in target or target.startswith("#"):
            continue
        target = target.split("#")[0]
        assert (ROOT / name).parent.joinpath(target).exists(), f"Broken local link: {name}: {target}"
index = (ROOT / "docs/ISSUE_INDEX.md").read_text()
rows = [line for line in index.splitlines() if line.startswith("| PLAN-") or re.match(r"\| \[#[0-9]+\]", line)]
assert len(rows) == 82, f"Expected 82 initial planned issues, found {len(rows)}; revise roadmap intentionally if scope changes"
assert len(set(rows)) == 82
print("Planning checks passed: required files, workflow, nine milestones, 82 issue rows, fences and local links.")
