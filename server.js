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
      { m: "JBB Constructions", x: false },
      { m: "JBB Infra", x: false }
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

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("bad store");
    store = {
      ver: Number(parsed.ver) || 0,
      data: parsed.data && typeof parsed.data === "object" ? parsed.data : seedData(),
      users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
      createdAt: parsed.createdAt || nowIso(),
      updatedAt: parsed.updatedAt || nowIso()
    };
    return store;
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[store] load failed:", e.message, "— starting from seed");
    store = freshStore();
    persist();
    return store;
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error("[store] persist failed:", e.message);
  }
}

/* ------------------------------------------------------------------ *
 * tokens  (stateless, HMAC signed)
 * ------------------------------------------------------------------ */
function issueToken(user) {
  const payload = { sub: user.id, role: user.role, exp: Date.now() + TOKEN_TTL_MS };
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
  return store.users[payload.sub] || null;
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
    // First sign-in provisions the account (panel allows any Gmail / mobile number).
    const firstUser = Object.keys(store.users).length === 0;
    user = {
      id,
      name: id.includes("@") ? id.split("@")[0] : id,
      role: firstUser ? "Admin" : "Manager",
      status: "active",
      createdAt: nowIso(),
      lastLoginAt: null
    };
    setPassword(user, password);
    store.users[id] = user;
  } else if (!checkPassword(user, password)) {
    return send(res, 401, { error: "Password galat hai" });
  }
  if (user.status === "disabled") return send(res, 403, { error: "Account band hai — admin se baat karein" });

  user.lastLoginAt = nowIso();
  persist();

  return send(res, 200, {
    token: issueToken(user),
    status: user.status || "active",
    user: { id: user.id, name: user.name, role: user.role }
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
  if (user.status === "disabled") {
    send(res, 403, { error: "Account band hai" });
    return null;
  }
  return user;
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
    return send(res, 200, { ok: true, ver: store.ver, uptime: Math.round(process.uptime()), users: Object.keys(store.users).length });
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

  if (p.startsWith("/auth/") || p === "/data") return send(res, 405, { error: "Method not allowed" });

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
  store = loadStore();
  if (!store.ver) persist();

  server.listen(PORT, HOST, () => {
    console.log("JBB PANEL running on http://" + HOST + ":" + PORT);
    console.log("Store: " + DATA_FILE + " (ver " + store.ver + ")");
  });
}

if (require.main === module) boot();

module.exports = { server, boot, getStore: () => store };
