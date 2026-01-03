# 5000 — Online Multiplayer Dice

A premium, hand-drawn-style dice game built as a static PWA. Real-time multiplayer via Firebase Realtime Database + Anonymous Auth, hosted on GitHub Pages.

## Features

- **Real-Time Multiplayer** — Create/join rooms with password protection.
- **Presence Tracking** — See who's online/offline in real-time.
- **Authoritative Turns** — Only the current player can roll, bank, or pass.
- **In-Room Chat** — Send messages to all room members.
- **PWA** — Installable on mobile, works offline for the shell.

## Rules Summary

| Category | Details |
|----------|---------|
| **Objective** | First to reach **exactly 5000** wins. |
| **Scoring** | A=100, K=50 (singles). Triples score big (AAA=1000, KKK=500, etc). |
| **600 Rule** | You must bank ≥600 in one turn to get on the board. |
| **Farkle** | Roll 0 points = lose turn score, pass. |
| **Hot Dice** | All 5 dice score = reset and keep rolling. |
| **Bump** | Bank the same total as someone else? They reset to 0. |

## Tech Stack

- **Frontend:** Vanilla JS, HTML5, CSS3 (no build step).
- **Backend:** Firebase 9 (Realtime Database, Anonymous Auth).
- **Hosting:** GitHub Pages via GitHub Actions.

## Local Development

1. Copy `config.example.js` → `config.js` and fill in your Firebase credentials.
2. Run a local server:
   ```bash
   python3 -m http.server 8080
   ```
3. Open http://localhost:8080

## Deployment

Automated via GitHub Actions on push to `main`.

### Required GitHub Secrets

Set these in **Settings → Secrets → Actions**:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_MEASUREMENT_ID`

## Firebase Setup

1. Enable **Anonymous Authentication** in Firebase Console.
2. Deploy `firebase.rules.json` to your Realtime Database via Firebase Console or CLI.

## Manual Test Checklist

- [ ] Create room → join from another device → host can start, others cannot.
- [ ] After start, new joins are rejected.
- [ ] Non-turn player cannot roll or bank.
- [ ] Bank disabled if total < 600 and player.score == 0.
- [ ] Bump resets other player to 0.
- [ ] Overshoot (> 5000) passes turn without updating score.
- [ ] Chat messages appear in real-time with proper escaping.
- [ ] Presence dot updates on disconnect.

## License

MIT
