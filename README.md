# JBB PANEL

Labour & advance management panel — workers, advances, expenses, income, settlements,
attendance and budgets. Single-page frontend (`index.html`) + a zero-dependency Node.js
backend (`server.js`).

## Quick start

```bash
npm start            # http://localhost:3000
# or
PORT=8080 node server.js
```

No `npm install` needed — there are no dependencies (Node **18+** required for `fetch`
in the helper scripts; the server itself runs on Node 14+).

Open the URL, then sign in with **any Gmail address or mobile number** and a password
of at least 4 characters:

| Field | Value |
| --- | --- |
| Login id | `admin@jbb.com` (or any Gmail / mobile) |
| Password | `jbb1234` (choose your own) |

The **first** account created becomes `Admin`; later accounts become `Manager`.
Credentials are stored as salted SHA-256 hashes — never in plain text.

## What the server provides

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/login` | Body `{id, password}` → `{token, user, status}`. Provisions the account on first sign-in. |
| `POST` | `/auth/logout` | Stateless logout acknowledgement. |
| `GET` | `/auth/me` | Current identity. |
| `GET` | `/data` | Full dataset + `ver` + `me`. Requires `Authorization: Bearer <token>`. |
| `PUT` | `/data` | Body `{base, data}` → `{ver}`. Returns **409** with the latest data if `base` is stale. |
| `GET` | `/api/health` | `{ok, ver, uptime, users}` — no auth. |

Saving is **optimistic-concurrency safe**: every write bumps `ver`, and a client holding an
old `ver` gets a `409 conflict` plus fresh data instead of silently overwriting someone
else's edits.

Tokens are stateless HMAC-SHA256 signed (7-day expiry) — no session table needed.

## Storage

Everything lives in `data/store.json` (atomic write via temp-file + rename):

```
data/
├── store.json     # dataset + version + user records
└── secret.key     # token signing key, chmod 600, generated on first boot
```

Both are git-ignored, and `server.js` refuses to serve anything inside `data/`, so the
store and secret can never be downloaded over HTTP.

To start over, delete `data/` and restart. On first boot the store is seeded with demo
data (5 workers, advances, expenses, income, budgets, 2 companies) so every screen has
something to show; clear it from the UI once you have real data.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Listen port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DATA_DIR` | `./data` | Where `store.json` / `secret.key` live. |
| `DATA_FILE` | `$DATA_DIR/store.json` | Explicit store path. |
| `JBB_SECRET` | *(from `secret.key`)* | Override the token signing secret. |

## Tests

```bash
npm start                     # in one terminal
node test/smoke.js            # in another
```

The smoke test executes the **real** client-side JS from `index.html` inside a stub DOM
against the live server, so it covers: login success/failure, the login error banner,
all nine tabs rendering without exceptions or `undefined`/`NaN` leakage, a worker added
through the UI persisting to the server, version bumping, and currency/escaping helpers.

## Screens

Dashboard · Workers · Advances · Expenses · Income · Settlements · Attendance · Budgets · Companies

## Notes

- Data model keys are terse to keep payloads small: `w` workers, `adv` advances,
  `ex` expenses, `inc` income, `sh` settlement history, `nl` NIL records, `a` attendance
  (`YYYY-MM-DD|personId`), `cos` companies, `bud` budgets.
- Settlement records are append-only: undo marks a row `REVERSED` and restores prior state
  rather than deleting it, so the audit trail is preserved.
- The panel is mobile-friendly; tables scroll horizontally under 760px.
