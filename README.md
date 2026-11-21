# JBB PANEL

Labour & advance management panel — workers, advances, expenses, income, settlements,
attendance and budgets. Single-page frontend (`index.html`) + a zero-dependency Node.js
backend (`server.js`).

## Live panel

### https://akash4447777-dev.github.io/jbb-panel-new/

Works on any device — laptop, phone, tablet. No install, no server, no login to GitHub.
Deployed automatically from `main` on every push via GitHub Actions.

**First-time login:** any Gmail address or mobile number + a password of 4+ characters.
The first account created becomes `Admin`.

This static deployment runs in **Offline mode**: data is stored in your browser's
`localStorage`, so there is no server to run and no login round-trip. All nine screens,
all CRUD operations, settlements and attendance work. Use **Settings** in the top-right
to switch between Offline and Cloud storage.

## Free database (₹0, never expires)

**[FREE-DATABASE.md](FREE-DATABASE.md)** — step-by-step guide in Hindi/Hinglish.

Short version: **Neon** gives 1 GB Postgres, no credit card, no expiry, and its limits
never delete your data. Render's own free database is **deleted after 30 days** — this
repo deliberately does not use it.

1. Create a free DB at **https://neon.com** (~2 min) → copy the connection string
2. Deploy: **https://render.com/deploy?repo=https://github.com/akash4447777-dev/jbb-panel-new**
3. Paste the string as `DATABASE_URL` when prompted
4. Open `https://YOUR-APP.onrender.com/api/health` → expect `"store":"postgres", "degraded":false`

## Syncing across devices (Cloud mode)

The Pages link keeps data **per device** (browser `localStorage`). To share one dataset
across phone, laptop and employees, deploy the included Node server — one click:

**https://render.com/deploy?repo=https://github.com/akash4447777-dev/jbb-panel-new**

Then open the panel with `?api=` pointing at it:

```
https://akash4447777-dev.github.io/jbb-panel-new/?api=https://YOUR-APP.onrender.com
```

Full instructions, alternatives (Railway, VPS) and the free-tier caveats:
**[DEPLOY.md](DEPLOY.md)**.

## Two ways to run

| | Offline (GitHub Pages) | Cloud (this repo's Node server) |
| --- | --- | --- |
| Runs on | any static host / phone | Node 18+ |
| Data lives | browser `localStorage` | `data/store.json` on the server |
| Shared between devices | no | yes |
| Password | screen-lock only* | salted SHA-256 |
| Setup | none | `npm start` |

\* Offline mode has no server to verify against, so the password is only a device
screen-lock and the data sits on the device in plain text. For a shared or sensitive
deployment use Cloud mode.

### Backing up offline data

Offline data lives in the browser's `localStorage`, so clearing site data or using
private browsing will erase it. **Settings → Export backup** downloads a JSON file;
**Restore backup** loads it back on any device. Do this before clearing browser data
or switching phones.

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
