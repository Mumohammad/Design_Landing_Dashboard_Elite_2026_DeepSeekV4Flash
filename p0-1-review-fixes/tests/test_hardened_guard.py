"""Validate the hardened P0-1 guard step: extract the run: block from
guard-step.yml and execute it under bash across realistic secret scenarios."""

import pathlib
import subprocess
import sys
import textwrap

import yaml

d = pathlib.Path("/data/p0-1-fix")
(d / "pwned.txt").unlink(missing_ok=True)
raw = (d / "guard-step.yml").read_text()

# The snippet is stored at the indentation it will occupy inside the workflow
# (4 spaces). Dedent the whole block so it parses as a standalone YAML list.
step = yaml.safe_load(textwrap.dedent(raw))[0]
assert step["name"] == "Verify production Supabase secrets"
assert set(step["env"]) == {
    "PRODUCTION_SUPABASE_URL",
    "PRODUCTION_SUPABASE_ANON_KEY",
    "PRODUCTION_SUPABASE_SERVICE_KEY",
    "STAGING_SUPABASE_URL",
}
print("YAML structure OK; env keys OK")

# Confirm no secret is interpolated inside the script body itself.
script = step["run"]
assert "secrets." not in script, "run: block must not reference secrets directly"
print("run: block contains no secrets interpolation")

(d / "guard.sh").write_text(script)
MALICIOUS = '"; echo INJECTED > /data/p0-1-fix/pwned.txt; echo "'
STAGING = "https://staging-abcdefgh.supabase.co"
PROD = "https://prod-zyxwvuts.supabase.co"

cases = [
    ("all secrets present, distinct from staging", {
        "PRODUCTION_SUPABASE_URL": PROD,
        "PRODUCTION_SUPABASE_ANON_KEY": "anon",
        "PRODUCTION_SUPABASE_SERVICE_KEY": "svc",
        "STAGING_SUPABASE_URL": STAGING,
    }, 0),
    ("secrets not configured at all", {
        "PRODUCTION_SUPABASE_URL": "",
        "PRODUCTION_SUPABASE_ANON_KEY": "",
        "PRODUCTION_SUPABASE_SERVICE_KEY": "",
        "STAGING_SUPABASE_URL": STAGING,
    }, 1),
    ("service key forgotten", {
        "PRODUCTION_SUPABASE_URL": PROD,
        "PRODUCTION_SUPABASE_ANON_KEY": "anon",
        "PRODUCTION_SUPABASE_SERVICE_KEY": "",
        "STAGING_SUPABASE_URL": STAGING,
    }, 1),
    ("REGRESSION: staging URL pasted into production secret", {
        "PRODUCTION_SUPABASE_URL": STAGING,
        "PRODUCTION_SUPABASE_ANON_KEY": "anon",
        "PRODUCTION_SUPABASE_SERVICE_KEY": "svc",
        "STAGING_SUPABASE_URL": STAGING,
    }, 1),
    ("INJECTION: secret contains shell metacharacters", {
        "PRODUCTION_SUPABASE_URL": MALICIOUS,
        "PRODUCTION_SUPABASE_ANON_KEY": "anon",
        "PRODUCTION_SUPABASE_SERVICE_KEY": "svc",
        "STAGING_SUPABASE_URL": STAGING,
    }, 0),
    ("staging secret absent (equality check skipped)", {
        "PRODUCTION_SUPABASE_URL": PROD,
        "PRODUCTION_SUPABASE_ANON_KEY": "anon",
        "PRODUCTION_SUPABASE_SERVICE_KEY": "svc",
        "STAGING_SUPABASE_URL": "",
    }, 0),
]

failures = 0
print()
for label, env, expected_rc in cases:
    env = {"PATH": "/usr/bin:/bin", **env}
    r = subprocess.run(
        ["bash", str(d / "guard.sh")], capture_output=True, text=True, env=env
    )
    ok = r.returncode == expected_rc and not r.stderr.strip()
    last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    print(f"[{'PASS' if ok else 'FAIL'}] {label}")
    print(f"       rc={r.returncode} (expected {expected_rc})  out={last!r}")
    if r.stderr.strip():
        print(f"       stderr={r.stderr.strip()!r}")
    if not ok:
        failures += 1

injected = (d / "pwned.txt").exists()
print()
print(f"[{'PASS' if not injected else 'FAIL'}] no command injection occurred")
if injected:
    failures += 1

print()
print("ALL HARDENED GUARD TESTS PASSED" if failures == 0 else f"{failures} FAILURE(S)")
sys.exit(1 if failures else 0)
