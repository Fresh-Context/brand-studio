#!/usr/bin/env python3
"""
Mint a long-lived, SCOPED Supabase JWT for the deployed Studio service.

The JWT carries role=studio_service, so PostgREST switches into the
deny-by-default role created by scripts/scoped-role.sql. The Coolify resource
uses this token as SUPABASE_SERVICE_KEY instead of the master service_role key
(per the app-estate-architecture plan, step A2). Do NOT run this — or apply
scoped-role.sql — until A1 (Studio actually deployed) is verified; see the
prerequisite note at the top of scoped-role.sql.

The JWT SECRET never leaves your machine: this script reads it via a hidden
prompt (getpass), signs locally, and prints only the resulting scoped token.
Find the secret in the Supabase dashboard:
  contextListener -> Project Settings -> API -> JWT Settings -> JWT Secret (legacy)

Usage:
  python3 scripts/mint-scoped-jwt.py
  (paste the JWT secret when prompted; copy the printed token)

Stdlib only. Modeled on fresh-context/radar/mint-scoped-jwt.py.
"""
import base64, hashlib, hmac, json, time, getpass, sys

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")

def main():
    secret = getpass.getpass("Paste the Supabase JWT secret (hidden): ").strip()
    if not secret:
        sys.exit("no secret provided")

    now = int(time.time())
    years = 5
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "role": "studio_service",
        "iss": "supabase",
        "iat": now,
        "exp": now + years * 365 * 24 * 3600,
    }
    signing_input = f"{b64url(json.dumps(header,separators=(',',':')).encode())}." \
                    f"{b64url(json.dumps(payload,separators=(',',':')).encode())}"
    sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    token = f"{signing_input}.{b64url(sig)}"

    print("\nstudio_service JWT (valid ~5 years, scoped to studio_* tables + read-only notes):\n")
    print(token)
    print("\nUse it as the Coolify resource's SUPABASE_SERVICE_KEY. If the API gateway")
    print("rejects it as `apikey`, also grab the project's anon/publishable key for the")
    print("apikey header (src/lib/supabase.js may need a second env var for that — check")
    print("before assuming the swap is a drop-in).")
    print("\nVerify before trusting it in prod: with this token in SUPABASE_SERVICE_KEY,")
    print("exercise every tab (gallery, generate incl. iteration, feedback capture,")
    print("voice & tone) end to end. If any call 401s/403s, either src/db.js reaches a")
    print("table not granted above, or a table's RLS state differs from what this")
    print("script assumed (studio_feedback/studio_brand_rules have no checked-in")
    print("migration — see scoped-role.sql). Fallback, pre-decided in the plan: keep the")
    print("service-role key confined to the Studio resource env rather than fight this.")

if __name__ == "__main__":
    main()
