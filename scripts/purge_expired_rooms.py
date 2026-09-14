#!/usr/bin/env python3
"""Delete Realtime Database rooms whose expiresAt (or createdAt + 7d) has passed."""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "https://project-4459811601599530195-default-rtdb.europe-west1.firebasedatabase.app"
TTL_MS = 7 * 24 * 60 * 60 * 1000


def token():
    t = os.environ.get("GOOGLE_ACCESS_TOKEN")
    if not t:
        sys.exit("GOOGLE_ACCESS_TOKEN is not set")
    return t


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
