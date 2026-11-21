# Cloud deploy — data sync across devices

The public link `https://akash4447777-dev.github.io/jbb-panel-new/` runs in **offline
mode**: data lives in each browser's `localStorage`. That means your laptop and your
phone keep **separate** copies.

**Cloud mode** fixes that: one server holds the data, so every device sees the same
workers, advances and expenses. It needs a Node host that can run `server.js`.

The server already supports two storage backends:

| `STORE_MODE` | Storage | Survives redeploy? | Use for |
| --- | --- | --- | --- |
| `file` (default) | `data/store.json` on disk | only with a persistent volume | VPS, local, Docker |
| `postgres` | managed Postgres, one JSON document | **yes** | free PaaS tiers |

`postgres` mode auto-activates when `DATABASE_URL` is set. If the `pg` package is
missing it logs a warning and falls back to file storage instead of crashing.

---

## Option A — Render (one click, recommended)

The repo ships `render.yaml`, a blueprint that creates **both** the web service and a
managed Postgres database, and wires `DATABASE_URL` automatically.

1. Open: **https://render.com/deploy?repo=https://github.com/akash4447777-dev/jbb-panel-new**
2. Sign in with GitHub (free account, no card needed for the free tier).
3. Approve access to the repo.
4. Click **Apply**.

Render reads `render.yaml` and creates:

- `jbb-panel` — the web service, `npm install` + `node server.js`
- `jbb-panel-db` — a free Postgres instance
- `JBB_SECRET` — generated automatically (signs login tokens)
- `STORE_MODE=postgres` with `DATABASE_URL` bound to the database

In ~2 minutes you get a URL like `https://jbb-panel.onrender.com`. Open `/api/health`
and you should see `{"ok":true,...}`.

### Free-tier caveat (important)

Render's free web services **sleep after ~15 minutes of inactivity**. The first request
afterwards takes ~30–50 seconds to wake up. Data is safe (it is in Postgres) — it is only
the process that sleeps. The free Postgres instance expires after 30 days unless upgraded.

---

## Option B — Railway

1. **https://railway.app/new** → *Deploy from GitHub repo* → pick `jbb-panel-new`
2. **+ New** → *Database* → **PostgreSQL**
3. On the web service → *Variables* → add:
   - `STORE_MODE` = `postgres`
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway reference variable)
   - `JBB_SECRET` = any long random string
4. Railway builds with `npm install` and starts with `node server.js` (`package.json`).

---

## Option C — any VPS / Docker

```bash
git clone https://github.com/akash4447777-dev/jbb-panel-new
cd jbb-panel-new
npm install --omit=dev      # installs pg, only needed for postgres mode
PORT=3000 STORE_MODE=file node server.js
```

Without `DATABASE_URL` this writes `data/store.json`. Put that directory on a mounted
volume, or point `DATA_DIR` at one.

---

## Connecting the panel to the cloud server

Once the server is live, the static panel (GitHub Pages) can talk to it — no rebuild of
anything, two ways:

**1. Shareable URL (easiest)** — append `?api=` with the server URL:

```
https://akash4447777-dev.github.io/jbb-panel-new/?api=https://jbb-panel.onrender.com
```

That link switches that browser to cloud mode and remembers the server. Send it to any
device and they are on the same data.

**2. In-app** — open the panel → **Settings** (top right) → Storage mode = **Cloud** →
paste the server URL → **Save**.

To go back to device-local data: Settings → **Offline**.

---

## Verifying a deploy

```bash
curl https://YOUR-APP.onrender.com/api/health
# {"ok":true,"ver":0,"uptime":3,"users":0}

curl -X POST https://YOUR-APP.onrender.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"id":"admin@jbb.com","password":"jbb1234"}'
# {"token":"…","user":{"id":"admin@jbb.com","name":"admin","role":"Admin"}}
```

The first account created on a fresh server becomes **Admin**.

---

## Security notes for a public deployment

- Passwords are salted SHA-256, tokens are HMAC-SHA256 signed with `JBB_SECRET`.
- **Set `JBB_SECRET` explicitly in production.** If unset, the server generates one into
  `data/secret.key`; on an ephemeral filesystem that file disappears on redeploy and every
  existing token is invalidated (users must log in again).
- First sign-in provisions an account, so anyone who reaches your URL can create one.
  For a private panel, keep the URL unlisted, or ask me to add an invite/signup allowlist.
- `data/` and `secret.key` are never served over HTTP (the static handler blocks them).
- Always use HTTPS — both Render and Railway give you a TLS certificate automatically.

---

## Which should I use?

| | Offline (GitHub Pages) | Cloud (Render) |
| --- | --- | --- |
| Setup | done ✅ | ~2 min, one click |
| Works offline | ✅ | ❌ needs network |
| Multiple devices in sync | ❌ | ✅ |
| Employees can enter data from their phones | ❌ separate copies | ✅ shared |
| Survives clearing browser data | ❌ (use Export backup) | ✅ |
| Slow first load | instant | ~40s after idle (free tier) |

For a single owner on one device, offline + Export backup is enough. For a real crew where
several people record advances, use Cloud.
