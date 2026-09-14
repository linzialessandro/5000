#!/usr/bin/env python3
"""Delete Realtime Database rooms whose expiresAt (or createdAt + 7d) has passed."""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://project-4459811601599530195-default-rtdb.europe-west1.firebasedatabase.app"
TTL_MS = 7 * 24 * 60 * 60 * 1000
SCOPES = (
    "https://www.googleapis.com/auth/firebase.database "
    "https://www.googleapis.com/auth/userinfo.email"
)
TOKEN_URI = "https://oauth2.googleapis.com/token"


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def token_from_service_account(path):
    """Mint an OAuth token from a service-account JSON key (no IAM Credentials API)."""
    with open(path) as f:
        sa = json.load(f)
    now = int(time.time())
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claim = b64url(
        json.dumps(
            {
                "iss": sa["client_email"],
                "scope": SCOPES,
                "aud": sa.get("token_uri", TOKEN_URI),
                "iat": now,
                "exp": now + 3600,
            },
            separators=(",", ":"),
        ).encode()
    )
    signing_input = f"{header}.{claim}".encode()
    fd, key_path = tempfile.mkstemp(suffix=".pem")
    try:
        os.write(fd, sa["private_key"].encode())
        os.close(fd)
        os.chmod(key_path, 0o600)
        sig = subprocess.check_output(
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=signing_input,
        )
    finally:
        try:
            os.remove(key_path)
        except OSError:
            pass
    assertion = f"{header}.{claim}.{b64url(sig)}"
    body = urllib.parse.urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }
    ).encode()
    req = urllib.request.Request(
        sa.get("token_uri", TOKEN_URI),
        data=body,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as resp:
        payload = json.loads(resp.read())
    access = payload.get("access_token")
    if not access:
        raise RuntimeError(f"token endpoint returned no access_token: {list(payload)}")
    return access


_cached_token = None


def token():
    global _cached_token
    if _cached_token:
        return _cached_token
    t = os.environ.get("GOOGLE_ACCESS_TOKEN")
    if t:
        _cached_token = t
        return t
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if creds and os.path.isfile(creds):
        _cached_token = token_from_service_account(creds)
        return _cached_token
    sys.exit("GOOGLE_ACCESS_TOKEN is not set and GOOGLE_APPLICATION_CREDENTIALS is missing")


def url(path):
    return f"{BASE}{path}.json"


def req(method, path):
    r = urllib.request.Request(
        url(path),
        method=method,
        headers={"Authorization": f"Bearer {token()}"},
    )
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise RuntimeError(f"{method} {path} -> {e.code} {e.read()[:300]!r}") from e


def main():
    now = int(time.time() * 1000)
    rooms = req("GET", "/rooms") or {}
    if not isinstance(rooms, dict) or not rooms:
        print("no rooms")
        return
    deleted = 0
    kept = 0
    for code, room in rooms.items():
        if not isinstance(room, dict):
            room = req("GET", f"/rooms/{code}") or {}
        expires = room.get("expiresAt")
        created = room.get("createdAt")
        if expires is None and created is not None:
            expires = created + TTL_MS
        if expires is None or expires <= now:
            req("DELETE", f"/rooms/{code}")
            print(f"deleted {code}")
            deleted += 1
        else:
            kept += 1
    print(f"done deleted={deleted} kept={kept}")


if __name__ == "__main__":
    main()
