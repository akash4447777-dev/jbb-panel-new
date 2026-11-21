# JBB PANEL

Labour & advance management panel — workers, advances, expenses, income, settlements,
attendance, payroll, manager funds, budgets and reports.

Frontend = `index.html` (shell + styles) plus six modules under `js/`, so no build step
and no dependencies. Backend = zero-dependency Node.js (`server.js`).

## Live panel

### https://akash4447777-dev.github.io/jbb-panel-new/

Works on any device — laptop, phone, tablet. No install, no server, no login to GitHub.
Deployed automatically from `main` on every push via GitHub Actions.

**First-time login:** any Gmail address or mobile number + a password of 6+ characters.
The **first** account becomes **Super Admin**. Everyone after that is created as *pending*
and can log in only once a Super Admin approves them (Settings → Users).

This static deployment runs in **Offline mode**: data is stored in your browser's
`localStorage`, so there is no server to run and no login round-trip. All twelve screens,
every CRUD operation, smart settlement, attendance and the reports work. Use **Settings**
in the top-right to switch between Offline and Cloud storage, or append
`?api=https://YOUR-APP.onrender.com` to the URL to point the panel at a server.

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
of at least 6 characters:

| Field | Value |
| --- | --- |
| Login id | `admin@jbb.com` (or any Gmail / mobile) |
| Password | `jbb1234` (choose your own) |

The **first** account created becomes **Super Admin**. Later accounts are created as
`pending` and cannot log in until a Super Admin approves them. Credentials are stored as
salted SHA-256 hashes — never in plain text.

## What the server provides

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/login` | Body `{id, password}` → `{token, user, status}`. Provisions the first account as Super Admin; later ones start `pending`. |
| `POST` | `/auth/logout` | Stateless logout acknowledgement. |
| `GET` | `/auth/me` | Current identity. |
| `GET` | `/data` | Full dataset + `ver` + `me`. Requires `Authorization: Bearer <token>`. |
| `PUT` | `/data` | Body `{base, data}` → `{ver}`. Returns **409** with the latest data if `base` is stale. |
| `GET` | `/users` | Super Admin only. `{users, me}` for the Settings → Users screen. |
| `POST` | `/users/act` | Super Admin only. Body `{uid, act}` where `act` is `approve`, `block`, `unblock`, `remove` or `role` (with `role`). |
| `POST` | `/auth/password` | Body `{old, next}` → `{token}`. Rotates the signing version, so older tokens stop working. |
| `GET` | `/api/health` | `{ok, ver, uptime, users, store, degraded}` — no auth. |

Saving is **optimistic-concurrency safe**: every write bumps `ver`, and a client holding an
old `ver` gets a `409 conflict` plus fresh data instead of silently overwriting someone
else's edits.

Tokens are stateless HMAC-SHA256 signed (7-day expiry) — no session table needed. Each
token also carries the account's `ver`, which is bumped on a password change or a
block/removal, so those tokens stop working immediately instead of living out their week.

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
npm test          # panel + postgres + end-to-end
```

| File | What it proves |
| --- | --- |
| `test/panel.js` | Runs the real `js/*.js` in a stub DOM in offline mode: money maths (GST/gross/partial/rejected), the worker ledger, settlement + undo + deductions, period filters, ageing buckets, GST summary, payroll, every screen rendering, old-panel data compatibility, persistence and CAS 409. |
| `test/smoke.js` | Boots `server.js` on an isolated store, then runs the same client against it in cloud mode: first-login provisioning, pending approval, `/users`, `/users/act`, password change, stale-token invalidation, all screens on live data, a UI write landing on the server, and CSV export. |
| `test/pg.js` | The Postgres storage layer against a stubbed pool, including degraded fallback. |

No browser and no network are needed — every test is self-contained.

## Screens

Dashboard · Workers · Attendance (workers / staff / managers) · Advances (sheet + list) ·
Manager Funds (transfers / advances / ledger) · Payroll · Settlements · Expenses · Income ·
Budget · Managers · Reports

## Features

- **Smart settlement** — settle a worker for any period; the closing balance becomes a
  NIL checkpoint, deductions reduce what carries forward, and every settlement is appended
  to history. Undo marks the row `REVERSED` and restores the previous state instead of
  deleting anything, so the audit trail survives. Bulk settle works for a whole manager.
- **Manager funds** — track money sent to each manager, advances drawn against it, and the
  running ledger per manager and company.
- **Payroll** — days from attendance (P = 1, H = 0.5), wage × days minus advances, with
  CSV and print-to-PDF output.
- **Reports** — ageing of payables and receivables with buckets, GST summary by rate,
  vendor outstanding, manager × month and category × manager matrices.
- **Budgets** — per-category and per-manager monthly caps with usage bars.
- **Exports** — CSV (Excel-safe: BOM + quoting) and print-window PDFs. No external library,
  so they also work in restricted preview environments.
- **User admin** — Super Admin approves, blocks, unblocks, removes and re-roles accounts.
  Password changes and blocks invalidate existing tokens immediately.

## Notes

- Data model keys are terse to keep payloads small: `w` workers, `adv` advances,
  `ex` expenses, `inc` income, `mp` manager transfers, `fa` fund advances,
  `sh` settlement history, `nl` NIL checkpoints (`workerId|YYYY-MM-DD`),
  `a` attendance (`YYYY-MM-DD|personId`), `t` extra attendance times, `s` staff,
  `cos` managers/companies, `bud` budgets (`{cat, mgr}`), `opt` settings.
- Records written by the previous version are upgraded in place on load (`migrate()` and
  `legacyFix()` in `js/core.js`); nothing is dropped, missing fields get safe defaults.
- Settlement records are append-only: undo marks a row `REVERSED` and restores prior state
  rather than deleting it, so the audit trail is preserved.
- The panel is mobile-friendly; tables scroll horizontally under 760px.
