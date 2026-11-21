"use strict";
/**
 * JBB PANEL — backend
 * Zero-dependency Node.js server for the JBB labor/advance panel.
 *
 *   POST /auth/login  { id, password }        -> { token, user:{id,name,role}, status }
 *   POST /auth/logout                          -> { ok }
 *   GET  /auth/me                              -> { user }
 *   GET  /data                                 -> { data, ver, me }
 *   PUT  /data         { base, data }          -> { ver } | 409 { conflict:true, data, ver }
 *   GET  /api/health                            -> { ok, ver, uptime }
 *
 * Storage: ./data/store.json (atomic write). Override with DATA_FILE env var.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, "store.json");
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_BODY = 8 * 1024 * 1024; // 8 MB

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */
function nowIso() {
  return new Date().toISOString();
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

function hmac(secret, s) {
  return crypto.createHmac("sha256", secret).update(String(s)).digest("base64url");
}

function b64(o) {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function unb64(s) {
  return JSON.parse(Buffer.from(String(s), "base64url").toString("utf8"));
}

/* ------------------------------------------------------------------ *
 * store
 * ------------------------------------------------------------------ */
let SECRET = process.env.JBB_SECRET || "";

function seedData() {
  const today = new Date();
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const back = (n) => iso(new Date(today.getTime() - n * 86400000));

  return {
    w: [
      { id: 1, n: "Ramesh Kumar", c: "1", wg: 550, r: "Mason", ph: "9810012345", em: "ramesh@example.com" },
      { id: 2, n: "Suresh Yadav", c: "1", wg: 500, r: "Helper", ph: "9810012346", em: "" },
      { id: 3, n: "Mahesh Singh", c: "2", wg: 600, r: "Carpenter", ph: "9810012347", em: "" },
      { id: 4, n: "Anil Sharma", c: "2", wg: 480, r: "Helper", ph: "9810012348", em: "" },
      { id: 5, n: "Vijay Verma", c: "1", wg: 0, r: "Painter", ph: "9810012349", em: "" }
    ],
    adv: [
      { id: 1, d: back(9), w: 1, t: "g", amt: 5000, note: "Ghar ke liye" },
      { id: 2, d: back(7), w: 2, t: "g", amt: 3000, note: "Medical" },
      { id: 3, d: back(5), w: 3, t: "g", amt: 7500, note: "School fees" },
      { id: 4, d: back(3), w: 1, t: "r", amt: 2000, note: "Wapas kiya" },
      { id: 5, d: back(2), w: 4, t: "g", amt: 2500, note: "Travel" }
    ],
    ex: [
      { id: 1, no: 1, d: back(10), v: "Sharma Cement Store", cat: "Material", c: "1", amt: 48500, ds: "INV-2201" },
      { id: 2, no: 2, d: back(6), v: "Gupta Steel", cat: "Material", c: "1", amt: 72500, ds: "INV-2233" },
      { id: 3, no: 3, d: back(4), v: "Truck Rentals", cat: "Transport", c: "2", amt: 12500, ds: "TR-118" }
    ],
    inc: [
      { id: 1, no: 1, d: back(8), v: "Mehra Builders", cat: "Contract", c: "1", amt: 150000, ds: "RC-551" },
      { id: 2, no: 2, d: back(2), v: "Sunrise Infra", cat: "Contract", c: "2", amt: 92000, ds: "RC-560" }
    ],
    mp: [],
    fa: [],
    sh: [],
    nl: {},
    a: {},
    t: [],
    s: [],
    cos: [
      { m: "JBB CONSTRUCTIONS", n: "JBB Constructions", x: 0 },
      { m: "JBB INFRA", n: "JBB Infra", x: 0 }
    ],
    bud: {
      cat: { Material: 200000, Transport: 50000, Salary: 150000 },
      mgr: [250000, 150000]
    }
  };
}

function freshStore() {
  return {
    ver: 0,
    data: seedData(),
    users: {},
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

let store = freshStore();

/* ------------------------------------------------------------------ *
 * persistence: "file" (default, local/VPS) or "postgres" (cloud)
 *
 * Postgres keeps ONE row holding the whole JSON document, matching the file
 * semantics exactly: reads are served from memory, every write replaces the
 * document and bumps ver. This keeps the API contract identical on every host
 * and avoids a schema migration.
 *
 *   DATABASE_URL=postgres://...  -> postgres mode
 *   STORE_MODE=postgres|file     -> force a mode
 * ------------------------------------------------------------------ */
const STORE_MODE =
  process.env.STORE_MODE ||
  (process.env.DATABASE_URL || process.env.POSTGRES_URL ? "postgres" : "file");
const PG_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const PG_TABLE = process.env.PG_TABLE || "jbb_store";

let pool = null;
let pgReady = false;

/* Roles written by the previous server were Title-Case ("Admin"/"Manager").
   The panel keys everything off lower-case super/admin/manager, so old stores
   would leave the owner without super powers. Map in place, never drop a user. */
const ROLE_MAP = { admin: "super", super: "super", manager: "admin", user: "manager", staff: "manager" };
const STATUS_MAP = { disabled: "blocked", blocked: "blocked", pending: "pending", active: "active" };

function migrateUsers(users) {
  for (const key of Object.keys(users)) {
    const u = users[key];
    if (!u || typeof u !== "object") { delete users[key]; continue; }
    const rawRole = String(u.role || "").trim();
    const role = ROLE_MAP[rawRole.toLowerCase()] || (rawRole === "Admin" ? "super" : "manager");
    u.role = role;
    u.status = STATUS_MAP[String(u.status || "active").toLowerCase()] || "active";
    if (!u.ver) u.ver = 1;
    if (!u.id) u.id = key;
  }
  /* guarantee exactly one super admin exists so the panel is never locked out */
  const all = Object.keys(users).map(k => users[k]);
  if (all.length && !all.some(u => u.role === "super")) {
    const oldest = all.slice().sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0];
    oldest.role = "super";
    oldest.status = "active";
  }
  return users;
}

function normalise(parsed) {
  const data = parsed.data && typeof parsed.data === "object" ? parsed.data : seedData();
  return {
    ver: Number(parsed.ver) || 0,
    data,
    users: migrateUsers(parsed.users && typeof parsed.users === "object" ? parsed.users : {}),
    createdAt: parsed.createdAt || nowIso(),
    updatedAt: parsed.updatedAt || nowIso()
  };
}

/* ---------------- file backend ---------------- */
function loadStoreFile() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    store = normalise(JSON.parse(raw));
    return store;
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[store] load failed:", e.message, "— starting from seed");
    store = freshStore();
    persistFile();
    return store;
  }
}

function persistFile() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error("[store] persist failed:", e.message);
  }
}

/* ---------------- postgres backend ----------------
 * Tuned for free managed Postgres (Neon, Supabase, Aiven):
 *  - free tiers suspend compute when idle, so every connection attempt is
 *    retried with backoff instead of failing the boot
 *  - the first query after a suspend pays a wake-up cost, so query timeouts
 *    are generous
 *  - any DB failure degrades to file storage rather than taking the app down,
 *    and a "degraded" flag is exposed on /api/health so it is visible
 * ------------------------------------------------------------------ */
let dbDegraded = false;
let dbLastError = null;

function pgClient() {
  if (!pgReady) {
    console.error(
      "[store] DATABASE_URL is set but the 'pg' package is not installed.\n" +
        "        Run: npm install pg    (or set STORE_MODE=file)"
    );
    return null;
  }
  return pool;
}

function pgInit() {
  try {
    const { Pool } = require("pg");
    const needsSsl = !/localhost|127\.0\.0\.1|sslmode=disable/.test(PG_URL);
    pool = new Pool({
      connectionString: PG_URL,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
      max: Number(process.env.PG_POOL_MAX || 3),
      // free tiers can take seconds to wake from suspend
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 15000),
      idleTimeoutMillis: 30000,
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 20000),
      keepAlive: true
    });
    // never let a background socket error crash the process
    pool.on("error", (e) => {
      dbDegraded = true;
      dbLastError = e.message;
      console.error("[store] postgres pool error:", e.message);
    });
    pgReady = true;
    return true;
  } catch (e) {
    console.error("[store] could not load pg:", e.message);
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withPgRetry(label, fn, attempts) {
  const tries = attempts || Number(process.env.PG_RETRIES || 4);
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const out = await fn();
      dbDegraded = false;
      return out;
    } catch (e) {
      lastErr = e;
      dbLastError = e.message;
      const transient =
        /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|terminating connection|Connection terminated|timeout|starting up|too many clients/i.test(
          e.message
        );
      if (i === tries || !transient) break;
      const wait = Math.min(1000 * 2 ** (i - 1), 8000);
      console.error("[store] " + label + " failed (" + e.message + "), retry " + i + "/" + (tries - 1) + " in " + wait + "ms");
      await sleep(wait);
    }
  }
  dbDegraded = true;
  throw lastErr;
}

async function loadStorePg() {
  if (!pgInit()) {
    console.error("[store] falling back to file storage");
    return loadStoreFile();
  }
  try {
    await withPgRetry("connect", async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${PG_TABLE} (
           id         integer PRIMARY KEY DEFAULT 1,
           doc        jsonb   NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now(),
           CONSTRAINT ${PG_TABLE}_single_row CHECK (id = 1)
         )`
      );
    });

    const r = await withPgRetry("load", () => pool.query(`SELECT doc FROM ${PG_TABLE} WHERE id = 1`));

    if (!r.rows.length) {
      store = freshStore();
      await withPgRetry("seed", () =>
        pool.query(`INSERT INTO ${PG_TABLE} (id, doc) VALUES (1, $1)`, [JSON.stringify(store)])
      );
      console.log("[store] postgres: seeded a new document");
      return store;
    }
    store = normalise(r.rows[0].doc);
    dbDegraded = false;
    console.log(
      "[store] postgres: loaded (ver " + store.ver + ", users " + Object.keys(store.users).length + ")"
    );
    return store;
  } catch (e) {
    console.error("[store] postgres unavailable after retries:", e.message);
    console.error("[store] serving from file storage; existing DB rows are untouched");
    return loadStoreFile();
  }
}

async function persistPg() {
  const c = pgClient();
  if (!c) return;
  try {
    await withPgRetry(
      "persist",
      () =>
        c.query(
          `INSERT INTO ${PG_TABLE} (id, doc, updated_at) VALUES (1, $1, now())
           ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
          [JSON.stringify(store)]
        ),
      Math.min(Number(process.env.PG_RETRIES || 4), 3)
    );
  } catch (e) {
    // last resort: keep the write on local disk so it is not lost
    console.error("[store] postgres persist failed, writing to disk as a safety net:", e.message);
    persistFile();
  }
}

/* ---------------- dispatchers ---------------- */
function loadStore() {
  if (STORE_MODE !== "postgres") return loadStoreFile();
  // synchronous callers (boot) get the seed; boot() awaits the async load
  return store;
}

function persist() {
  if (STORE_MODE !== "postgres") return persistFile();
  // fire-and-forget: the response must not wait on disk, but errors are logged
  persistPg().catch((e) => console.error("[store] persist error:", e.message));
}

/* ------------------------------------------------------------------ *
 * tokens  (stateless, HMAC signed)
 * ------------------------------------------------------------------ */
function issueToken(user) {
  const payload = { sub: user.id, role: user.role, ver: user.ver || 1, exp: Date.now() + TOKEN_TTL_MS };
  const body = b64(payload);
  return body + "." + hmac(SECRET, body);
}

function readToken(tok) {
  if (!tok || typeof tok !== "string") return null;
  const i = tok.lastIndexOf(".");
  if (i < 1) return null;
  const body = tok.slice(0, i);
  const sig = tok.slice(i + 1);
  const expect = hmac(SECRET, body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = unb64(body);
  } catch (e) {
    return null;
  }
  if (!payload || !payload.exp || payload.exp < Date.now()) return null;
  const user = store.users[payload.sub];
  if (!user) return null;
  /* a stale ver means the account was blocked, removed or re-passworded since this
     token was issued — that token must stop working immediately */
  if ((payload.ver || 1) !== (user.ver || 1)) return null;
  return user;
}

/* ------------------------------------------------------------------ *
 * http plumbing
 * ------------------------------------------------------------------ */
function send(res, code, body, headers) {
  const h = Object.assign(
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    },
    headers || {}
  );
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, h);
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : "";
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || file.includes("..")) {
    return send(res, 403, { error: "Forbidden" });
  }
  // never expose the store or server source
  const base = path.basename(file);
  if (file.startsWith(DATA_DIR) || base === "server.js" || base.endsWith(".tmp")) {
    return send(res, 404, { error: "Not found" });
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ------------------------------------------------------------------ *
 * auth routes
 * ------------------------------------------------------------------ */
function normId(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

function checkPassword(user, password) {
  const got = sha256(user.salt + ":" + password);
  const a = Buffer.from(got);
  const b = Buffer.from(user.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setPassword(user, password) {
  user.salt = crypto.randomBytes(16).toString("hex");
  user.hash = sha256(user.salt + ":" + password);
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const id = normId(body.id);
  const password = String(body.password == null ? "" : body.password);
  if (!id || !password) return send(res, 400, { error: "Gmail/Mobile number aur password dono chahiye" });
  if (id.length > 190) return send(res, 400, { error: "Login id bahut lamba hai" });
  if (password.length < 4) return send(res, 400, { error: "Password kam se kam 4 characters ka hona chahiye" });

  let user = store.users[id];
  if (!user) {
    // First sign-in provisions the Super Admin; everyone after must be approved.
    const firstUser = Object.keys(store.users).length === 0;
    user = {
      id,
      name: id.includes("@") ? id.split("@")[0] : id,
      role: firstUser ? "super" : "manager",
      status: firstUser ? "active" : "pending",
      ver: 1,
      createdAt: nowIso(),
      lastLoginAt: null
    };
    setPassword(user, password);
    store.users[id] = user;
    persist();
    if (!firstUser) {
      return send(res, 403, { error: "Aapki request Super Admin ke paas hai. Approve hone par login chalega." });
    }
  } else {
    if (!checkPassword(user, password)) return send(res, 401, { error: "Gmail/number ya password galat hai" });
    if (user.status === "pending") {
      return send(res, 403, { error: "Aapki request Super Admin ke paas hai. Approve hone par login chalega." });
    }
    if (user.status !== "active") return send(res, 403, { error: "Ye account band hai. Super Admin se baat karein." });
  }

  user.lastLoginAt = nowIso();
  persist();

  return send(res, 200, {
    token: issueToken(user),
    status: user.status || "active",
    user: publicUser(user)
  });
}

/* ------------------------------------------------------------------ *
 * data routes
 * ------------------------------------------------------------------ */
function requireUser(req, res) {
  const user = readToken(bearer(req));
  if (!user) {
    send(res, 401, { error: "Login required" });
    return null;
  }
  if (user.status && user.status !== "active") {
    send(res, 403, { error: "Account band hai" });
    return null;
  }
  return user;
}

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, status: u.status };
}

/* ------------------------------------------------------------------ *
 * user admin (Super Admin only) — panel calls GET /users, POST /users/act
 * ------------------------------------------------------------------ */
function requireSuper(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (user.role !== "super") {
    send(res, 403, { error: "Sirf Super Admin user manage kar sakta hai" });
    return null;
  }
  return user;
}

function handleGetUsers(req, res) {
  const me = requireSuper(req, res);
  if (!me) return;
  const users = Object.keys(store.users)
    .map(k => store.users[k])
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(u => Object.assign(publicUser(u), { createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null }));
  return send(res, 200, { users, me: publicUser(me) });
}

async function handleUserAct(req, res) {
  const me = requireSuper(req, res);
  if (!me) return;
  const body = await readBody(req);
  const uid = normId(body.uid || body.id);
  const act = String(body.act || "");
  const target = store.users[uid];
  if (!target) return send(res, 404, { error: "User nahi mila" });
  if (uid === me.id && (act === "block" || act === "remove")) {
    return send(res, 400, { error: "Apne aap ko block ya remove nahi kar sakte" });
  }
  if (act === "approve") { target.status = "active"; if (!target.role || target.role === "manager") target.role = "admin"; }
  else if (act === "block") target.status = "blocked";
  else if (act === "unblock") target.status = "active";
  else if (act === "remove") delete store.users[uid];
  else if (act === "role") {
    const role = String(body.role || "");
    if (!["super", "admin", "manager"].includes(role)) return send(res, 400, { error: "Role galat hai" });
    if (uid === me.id && role !== "super") return send(res, 400, { error: "Apna Super Admin role nahi hata sakte" });
    target.role = role;
  } else return send(res, 400, { error: "Act samajh nahi aaya" });

  /* bumping ver invalidates tokens issued before a block/removal */
  if (act === "block" || act === "remove") target.ver = (target.ver || 1) + 1;
  persist();
  return send(res, 200, { ok: true, user: store.users[uid] ? publicUser(store.users[uid]) : null });
}

async function handlePassword(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readBody(req);
  const oldPw = String(body.old == null ? "" : body.old);
  const next = String(body.next == null ? body.password : body.next);
  if (!checkPassword(user, oldPw)) return send(res, 400, { error: "Current password galat hai" });
  if (next.length < 6) return send(res, 400, { error: "Naya password kam se kam 6 characters ka ho" });
  setPassword(user, next);
  user.ver = (user.ver || 1) + 1;
  persist();
  return send(res, 200, { ok: true, token: issueToken(user) });
}

function handleGetData(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  send(res, 200, {
    data: store.data,
    ver: store.ver,
    me: { id: user.id, name: user.name, role: user.role },
    updatedAt: store.updatedAt
  });
}

async function handlePutData(req, res) {
  const user = requireUser(req, res);
  if (!user) return;
  const body = await readBody(req);
  if (!body || typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) {
    return send(res, 400, { error: "data object chahiye" });
  }
  const base = Number(body.base);
  if (Number.isFinite(base) && base !== store.ver) {
    return send(res, 409, {
      error: "Kisi aur ne data badal diya — reload karein",
      conflict: true,
      data: store.data,
      ver: store.ver
    });
  }
  const next = Object.assign({}, body.data);
  // keep the schema keys the UI relies on
  for (const k of ["w", "adv", "ex", "inc", "mp", "fa", "sh", "nl", "a", "t", "s", "cos"]) {
    if (next[k] === undefined || next[k] === null) next[k] = k === "nl" || k === "a" ? {} : [];
  }
  if (!next.bud || typeof next.bud !== "object") next.bud = { cat: {}, mgr: [] };
  if (!next.bud.cat || typeof next.bud.cat !== "object") next.bud.cat = {};
  if (!Array.isArray(next.bud.mgr)) next.bud.mgr = [];

  store.data = next;
  store.ver += 1;
  store.updatedAt = nowIso();
  persist();
  return send(res, 200, { ver: store.ver, updatedAt: store.updatedAt });
}

/* ------------------------------------------------------------------ *
 * router
 * ------------------------------------------------------------------ */
async function router(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method.toUpperCase();

  if (m === "OPTIONS") {
    return send(res, 204, "", {
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400"
    });
  }

  if (p === "/api/health" && m === "GET") {
    return send(res, 200, {
      ok: true,
      ver: store.ver,
      uptime: Math.round(process.uptime()),
      users: Object.keys(store.users).length,
      store: STORE_MODE,
      degraded: STORE_MODE === "postgres" ? dbDegraded : false,
      lastStoreError: dbDegraded ? dbLastError : null
    });
  }
  if (p === "/auth/login" && m === "POST") return handleLogin(req, res);
  if (p === "/auth/logout" && m === "POST") return send(res, 200, { ok: true });
  if (p === "/auth/me" && m === "GET") {
    const user = requireUser(req, res);
    if (!user) return;
    return send(res, 200, { user: { id: user.id, name: user.name, role: user.role } });
  }
  if (p === "/data" && m === "GET") return handleGetData(req, res);
  if (p === "/data" && m === "PUT") return handlePutData(req, res);
  if (p === "/users" && m === "GET") return handleGetUsers(req, res);
  if (p === "/users/act" && m === "POST") return handleUserAct(req, res);
  if (p === "/auth/password" && m === "POST") return handlePassword(req, res);

  if (p.startsWith("/auth/") || p.startsWith("/users") || p === "/data") {
    return send(res, 405, { error: "Method not allowed" });
  }

  if (m === "GET" || m === "HEAD") return serveStatic(req, res, p);
  return send(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  router(req, res).catch((err) => {
    const status = err && err.status ? err.status : 500;
    if (status >= 500) console.error("[req]", req.method, req.url, err);
    if (!res.headersSent) send(res, status, { error: err.message || "Server error" });
    else res.end();
  });
});

/* ------------------------------------------------------------------ *
 * boot
 * ------------------------------------------------------------------ */
function boot() {
  if (!SECRET) {
    const secretFile = path.join(DATA_DIR, "secret.key");
    try {
      SECRET = fs.readFileSync(secretFile, "utf8").trim();
    } catch (e) {}
    if (!SECRET) {
      SECRET = crypto.randomBytes(32).toString("hex");
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(secretFile, SECRET, { mode: 0o600 });
      } catch (e) {
        console.warn("[boot] could not persist secret:", e.message);
      }
    }
  }
  if (STORE_MODE === "postgres") {
    loadStorePg()
      .catch((e) => {
        console.error("[store] postgres unavailable:", e.message, "— falling back to file");
        loadStoreFile();
      })
      .finally(listen);
  } else {
    loadStoreFile();
    listen();
  }
}

function listen() {
  if (!store.ver) persist();
  server.listen(PORT, HOST, () => {
    console.log("JBB PANEL running on http://" + HOST + ":" + PORT);
    console.log(
      "Store: " +
        (STORE_MODE === "postgres" ? "postgres (table " + PG_TABLE + ")" : DATA_FILE) +
        " (ver " + store.ver + ")"
    );
  });
}

if (require.main === module) boot();

module.exports = { server, boot, getStore: () => store };
