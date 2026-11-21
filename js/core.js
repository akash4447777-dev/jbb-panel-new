"use strict";
/* ============================================================================
   JBB PANEL — core: state, storage, auth, helpers
   Two storage modes:
     local  — localStorage (GitHub Pages / file://), no server needed
     cloud  — the Node server in this repo (shared data, real password hashing)
   ========================================================================== */

/* ---------------- constants ---------------- */
const MN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FM = MN.slice(3).concat(MN.slice(0, 3));                 // fiscal order Apr..Mar
const FYS = [2023,2024,2025,2026,2027,2028,2029,2030,2031].map(y => `FY ${y}-${String(y + 1).slice(2)}`);
const PS = ["Paid", "Partial", "Pending"];                      // expense payment status
const AS = ["Approved", "Awaiting Approval", "Rejected"];        // approval
const IS = ["Received", "Pending"];                             // income status
const ROLES = { super: "Super Admin", admin: "Admin", manager: "Manager" };
const LKEY = "jbb_db_v3", PKEY = "jbb_prefs_v3", TOK = "bm_tok";

/* default master lists (editable in Settings) */
const SUBS_DEF = "Rent & Lease:Shop Rent,Warehouse Rent,Office Rent,Equipment Lease|Salary & Wages:Staff Salary,Daily Wages,Bonus & Incentives,Overtime|Utilities:Electricity,Internet,Water,Phone / Mobile|Purchase & Inventory:Goods for Resale,Raw Material,Packaging,Freight Inward|Marketing & Advertising:Social Media Ads,Search Ads,Printing & Flyers,Festival Campaign|Transport & Logistics:Freight Outward,Fuel,Vehicle Hire,Courier|Repairs & Maintenance:AC Repair,Computer Repair,Building Repair,Vehicle Repair|Office & Admin:Stationery,Software / Subscriptions,Cleaning,Refreshments|Taxes & Compliance:GST Payment,Income Tax,Licence & Fees,Professional Tax|Professional Fees:CA / Audit,Legal,Consulting|Insurance:Stock Insurance,Vehicle Insurance,Health Insurance|Bank & Finance:Bank Charges,Loan Interest,Card Fees|Travel & Entertainment:Travel,Hotel,Client Meals|Assets & Equipment:Machinery,Furniture,Computers,Display Racks|Miscellaneous:Other";

function parseCats(text) {
  const cat = [], sub = {};
  String(text).split(/\n|\|/).forEach(line => {
    const i = line.indexOf(":");
    const c = (i < 0 ? line : line.slice(0, i)).trim();
    if (!c) return;
    cat.push(c);
    sub[c] = i < 0 ? [] : line.slice(i + 1).split(",").map(s => s.trim()).filter(Boolean);
  });
  return { cat, sub };
}
const DM_DEF = Object.assign(parseCats(SUBS_DEF), {
  dep: "Management,Sales,Purchase,Accounts,HR,Operations,Marketing,IT,Logistics,Store / Retail".split(","),
  br: "Shop 1 - Main,Shop 2,Shop 3,Warehouse,Head Office,Online Store".split(","),
  md: "Cash,UPI,Bank Transfer,Cheque,Debit Card,Credit Card,Wallet,On Credit".split(","),
  src: "Retail Sales,Wholesale Sales,Online Sales,Service Income,Other Income".split(","),
  gst: [0, 0.05, 0.12, 0.18, 0.28]
});

/* ---------------- tiny utils ---------------- */
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* quote a value for use inside an HTML on*="" attribute */
const jsq = v => esc("'" + String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'");
const num = n => Math.round(+n || 0).toLocaleString("en-IN");
const rs = n => "₹" + num(n);
const fmt2 = n => (+n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (arr, f) => (arr || []).reduce((t, x) => t + (typeof f === "function" ? +f(x) || 0 : +x[f] || 0), 0);
const uniq = a => [...new Set(a)];
const pad2 = n => String(n).padStart(2, "0");
const pad4 = n => String(n).padStart(4, "0");
function today() { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function fyOf(d) {
  if (!d) return "";
  const y = +d.slice(0, 4), m = +d.slice(5, 7);
  return m >= 4 ? `FY ${y}-${String(y + 1).slice(2)}` : `FY ${y - 1}-${String(y).slice(2)}`;
}
const mnOf = d => (d ? MN[+d.slice(5, 7) - 1] : "");
function monthEnd(m) { const [y, n] = String(m).split("-").map(Number); return new Date(Date.UTC(y, n, 0)).toISOString().slice(0, 10); }
function daysInMonth(m) { const [y, n] = String(m).split("-").map(Number); return new Date(y, n, 0).getDate(); }
function addDay(d, n) { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
const isSunday = (m, d) => { const [y, n] = String(m).split("-").map(Number); return new Date(y, n - 1, d).getDay() === 0; };
const weekday = (m, d) => { const [y, n] = String(m).split("-").map(Number); return "SMTWTFS"[new Date(y, n - 1, d).getDay()]; };
function mins(i, o) {
  if (!i || !o) return 0;
  const [ih, im] = String(i).split(":").map(Number), [oh, om] = String(o).split(":").map(Number);
  let t = (oh * 60 + om) - (ih * 60 + im);
  if (t < 0) t += 1440;
  return t;
}
function fmtT(t) { if (!t) return ""; const [h, m] = String(t).split(":").map(Number); const ap = h < 12 ? "AM" : "PM"; const hh = h % 12 || 12; return hh + ":" + pad2(m) + " " + ap; }

/* ---------------- prefs / mode ---------------- */
function prefs() { try { return JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch (e) { return {}; } }
function setPrefs(o) { try { localStorage.setItem(PKEY, JSON.stringify(Object.assign(prefs(), o))); } catch (e) {} }
function cloudBase() { return String(prefs().cloudBase || "").replace(/\/+$/, ""); }

let MODE = "cloud";
(function resolveMode() {
  const qs = new URLSearchParams(location.search || "");
  const api = String(qs.get("api") || "").trim();
  if (/^https?:\/\//.test(api)) { setPrefs({ mode: "cloud", cloudBase: api.replace(/\/+$/, "") }); MODE = "cloud"; return; }
  const p = prefs();
  if (p.mode === "local" || p.mode === "cloud") { MODE = p.mode; return; }
  const h = String(location.hostname || "");
  MODE = (location.protocol === "file:" || /\.github\.io$/.test(h) || /\.pages\.dev$/.test(h) || h === "") ? "local" : "cloud";
})();

/* ---------------- state ---------------- */
const SEED = {
  n: 1, nx: 1, ni: 1,
  cos: [], w: [], adv: [], ex: [], inc: [], mp: [], fa: [],
  a: {}, t: {}, u: [], s: [], sh: [], nl: {},
  m: JSON.parse(JSON.stringify(DM_DEF)),
  bud: { cat: {}, mgr: {} },
  opt: { pw: 0, title: "JBB PANEL" }
};
let D = JSON.parse(JSON.stringify(SEED));
let VER = 0, ME = null;

/* view state */
let tab = "dash", q = "", lim = 100;
let co = "0", br = "0", dp = "0";
let date = today(), gm = today().slice(0, 7), fy = fyOf(today()), mn = "All";
let as = "w";                    // attendance group: w|o|m
let av = "s";                    // advances view: s(sheet)|l(list)
let fv = "d";                    // funds view: d|t|a
let onlyE = false;
let undoStack = [];

/* ---------------- migrate / seed ---------------- */
function migrate() {
  D = D && typeof D === "object" ? D : JSON.parse(JSON.stringify(SEED));
  for (const k of ["cos", "w", "adv", "ex", "inc", "mp", "fa", "u", "s", "sh"]) if (!Array.isArray(D[k])) D[k] = [];
  for (const k of ["a", "t", "nl"]) if (!D[k] || typeof D[k] !== "object" || Array.isArray(D[k])) D[k] = {};
  if (!D.m || typeof D.m !== "object") D.m = JSON.parse(JSON.stringify(DM_DEF));
  for (const k of ["cat", "sub", "dep", "br", "md", "src", "gst"]) if (!D.m[k]) D.m[k] = JSON.parse(JSON.stringify(DM_DEF[k]));
  if (!D.bud) D.bud = { cat: {}, mgr: {} };
  if (!D.bud.cat) D.bud.cat = {};
  if (!D.bud.mgr) D.bud.mgr = {};
  if (!D.opt) D.opt = { pw: 0, title: "JBB PANEL" };
  D.n = Math.max(+D.n || 1, 1);
  D.nx = Math.max(+D.nx || 1, 1);
  D.ni = Math.max(+D.ni || 1, 1);
  /* keep id counters ahead of existing rows */
  for (const k of ["w", "adv", "ex", "inc", "mp", "fa", "u", "s", "sh"]) for (const r of D[k]) D.n = Math.max(D.n, (+r.id || 0) + 1);
  for (const r of D.ex) D.nx = Math.max(D.nx, (+r.no || 0) + 1);
  for (const r of D.inc) D.ni = Math.max(D.ni, (+r.no || 0) + 1);
  legacyFix();
  return D;
}

/* ---- upgrade records written by the previous panel version ----
   The old panel stored: companies as {m,x:boolean}, users in D.u with forked
   names, and expense/income rows without the newer fields (br, dp, sub, due...).
   Nothing is dropped; missing keys get safe defaults so old rows keep working. */
function legacyFix() {
  for (const c of D.cos) {
    if (c.n == null) c.n = String(c.m || "").toUpperCase();
    if (typeof c.x === "boolean") c.x = c.x ? 1 : 0;
    if (c.x == null) c.x = 0;
    if (!c.m) c.m = c.n || "MANAGER";
  }
  const B = D.m.br[0] || "", P = D.m.dep[0] || "", M = D.m.md[0] || "";
  for (const x of D.ex) {
    if (x.br == null) x.br = x.c ? B : B;
    if (x.dp == null) x.dp = P;
    if (x.sub == null) x.sub = ((D.m.sub[x.cat] || [])[0]) || "";
    if (x.g == null) x.g = 0;
    if (x.pp == null) x.pp = 0;
    if (x.due == null) x.due = "";
    if (x.st == null) x.st = "Paid";
    if (x.ap == null) x.ap = "Approved";
    if (x.md == null) x.md = M;
    if (x.inv == null) x.inv = "";
    if (x.ds == null) x.ds = "";
  }
  for (const x of D.inc) {
    if (x.br == null) x.br = B;
    if (x.g == null) x.g = 0;
    if (x.st == null) x.st = "Received";
    if (x.md == null) x.md = M;
    if (x.ref == null) x.ref = "";
    if (x.party == null) x.party = "";
  }
  for (const a of D.adv) { if (a.note == null) a.note = ""; if (a.t == null) a.t = "g"; }
  for (const w of D.w) {
    if (w.wg == null) w.wg = 0;
    if (w.r == null) w.r = "";
    if (w.c == null) w.c = "1";
  }
  /* old panel used a single staff array key "s" with group codes m/o */
  for (const st of D.s) if (st.g == null) st.g = "o";
  return D;
}

/* legacy shape helpers: the older panel stored companies as {m,x} and used "a"/"s" keys */
function seedDemo() {
  const back = n => addDay(today(), -n);
  return {
    n: 40, nx: 4, ni: 3,
    cos: [
      { m: "JBB CONSTRUCTIONS", n: "JBB Constructions", x: 0 },
      { m: "JBB INFRA", n: "JBB Infra", x: 0 }
    ],
    w: [
      { id: 1, n: "Ramesh Kumar", c: "1", wg: 550, r: "Mason" },
      { id: 2, n: "Suresh Yadav", c: "1", wg: 500, r: "Helper" },
      { id: 3, n: "Mahesh Singh", c: "2", wg: 600, r: "Carpenter" },
      { id: 4, n: "Anil Sharma", c: "2", wg: 480, r: "Helper" },
      { id: 5, n: "Vijay Verma", c: "1", wg: 0, r: "Painter" }
    ],
    adv: [
      { id: 1, d: back(9), w: 1, t: "g", amt: 5000, note: "Ghar ke liye" },
      { id: 2, d: back(7), w: 2, t: "g", amt: 3000, note: "Medical" },
      { id: 3, d: back(5), w: 3, t: "g", amt: 7500, note: "School fees" },
      { id: 4, d: back(3), w: 1, t: "r", amt: 2000, note: "Wapas kiya" },
      { id: 5, d: back(2), w: 4, t: "g", amt: 2500, note: "Travel" }
    ],
    ex: [
      { id: 1, no: 1, d: back(10), c: "1", br: "Shop 1 - Main", dp: "Purchase", cat: "Purchase & Inventory", sub: "Raw Material", v: "Sharma Cement Store", ds: "Cement 50 bags", inv: "INV-2201", amt: 48500, g: 0.18, md: "Bank Transfer", st: "Paid", pp: 0, due: "", ap: "Approved" },
      { id: 2, no: 2, d: back(6), c: "1", br: "Shop 1 - Main", dp: "Purchase", cat: "Purchase & Inventory", sub: "Raw Material", v: "Gupta Steel", ds: "TMT bars", inv: "INV-2233", amt: 72500, g: 0.18, md: "On Credit", st: "Partial", pp: 40000, due: back(-10), ap: "Approved" },
      { id: 3, no: 3, d: back(4), c: "2", br: "Warehouse", dp: "Operations", cat: "Transport & Logistics", sub: "Vehicle Hire", v: "Truck Rentals", ds: "Site delivery", inv: "TR-118", amt: 12500, g: 0.05, md: "Cash", st: "Pending", pp: 0, due: back(-5), ap: "Awaiting Approval" }
    ],
    inc: [
      { id: 1, no: 1, d: back(8), c: "1", br: "Shop 1 - Main", src: "Wholesale Sales", party: "Mehra Builders", md: "Bank Transfer", ref: "RC-551", amt: 150000, g: 0.18, st: "Received" },
      { id: 2, no: 2, d: back(2), c: "2", br: "Warehouse", src: "Retail Sales", party: "Sunrise Infra", md: "UPI", ref: "RC-560", amt: 92000, g: 0.18, st: "Pending" }
    ],
    mp: [
      { id: 1, d: back(12), c: "1", amt: 60000, rem: "Shop 1 float" },
      { id: 2, d: back(11), c: "2", amt: 40000, rem: "Warehouse float" }
    ],
    fa: [
      { id: 1, d: back(9), c: "1", tr: 1, w: "Ramesh Kumar", amt: 5000, rem: "" },
      { id: 2, d: back(7), c: "1", tr: 1, w: "Suresh Yadav", amt: 3000, rem: "" }
    ],
    a: {},
    t: {},
    u: [],
    s: [
      { id: 31, n: "Priya Nair", g: "o" },
      { id: 32, n: "Arun Das", g: "o" },
      { id: 33, n: "Sunil Rao", g: "m" }
    ],
    sh: [], nl: {},
    m: JSON.parse(JSON.stringify(DM_DEF)),
    bud: { cat: { "Salary & Wages": 400000, "Purchase & Inventory": 900000 }, mgr: { "1": 500000, "2": 300000 } },
    opt: { pw: 1, title: "JBB PANEL" }
  };
}

/* ---------------- local storage backend ---------------- */
function dbLoadLocal() {
  try { const raw = localStorage.getItem(LKEY); if (raw) return JSON.parse(raw); } catch (e) {}
  return null;
}
function dbSaveLocal(db) {
  try { localStorage.setItem(LKEY, JSON.stringify(db)); return true; }
  catch (e) { toast("Device storage full — Settings se backup lekar jagah banayein."); return false; }
}
function localDbInit() {
  let db = dbLoadLocal();
  if (!db) { db = { ver: 0, data: seedDemo(), users: {}, createdAt: nowIso() }; migrateFrom(db); dbSaveLocal(db); }
  return db;
}
function migrateFrom(db) {
  if (!db || !db.data) return;
  /* the old panel stored companies as {m} only, and users separately */
  db.data = Object.assign({}, SEED, db.data);
  for (const c of db.data.cos || []) { if (c.n == null) c.n = String(c.m || "").toUpperCase(); if (c.x == null) c.x = 0; }
  if (!db.users) db.users = {};
  return db;
}

/* local password: screen lock only (no server to verify against) */
function pwHash(id, pw) {
  let h = 5381; const s = id + "\u0001" + pw;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "h" + (h >>> 0).toString(36) + "." + s.length;
}
function localUser() {
  const t = localStorage.getItem(TOK) || "";
  if (t.indexOf("local:") !== 0) return null;
  const db = dbLoadLocal();
  return db && db.users ? db.users[t.slice(6)] || null : null;
}

/* ---------------- local API (mirrors the server contract) ---------------- */
async function localApi(m, p, b) {
  if (p === "/auth/login") {
    const id = String((b && b.id) || "").trim().toLowerCase(), pw = String((b && b.password) || "");
    if (!id) return { _s: 400, ok: false, error: "Gmail/number likhein" };
    if (pw.length < 6) return { _s: 400, ok: false, error: "Password kam se kam 6 characters ka hona chahiye" };
    const db = localDbInit();
    let u = db.users[id];
    if (!u) {
      const first = Object.keys(db.users).length === 0;
      u = db.users[id] = {
        id, name: id.indexOf("@") > 0 ? id.split("@")[0] : id,
        role: first ? "super" : "admin", status: first ? "active" : "pending",
        pw: pwHash(id, pw), at: nowIso()
      };
      dbSaveLocal(db);
      if (!first) return { _s: 403, ok: false, error: "Aapki request Super Admin ke paas hai. Approve hone par login chalega." };
    } else if (u.pw !== pwHash(id, pw)) {
      return { _s: 401, ok: false, error: "Gmail/number ya password galat hai" };
    }
    if (u.status === "pending") return { _s: 403, ok: false, error: "Aapki request Super Admin ke paas hai. Approve hone par login chalega." };
    if (u.status !== "active") return { _s: 403, ok: false, error: "Ye account band hai. Super Admin se baat karein." };
    return { _s: 200, ok: true, token: "local:" + id, user: { id: u.id, name: u.name, role: u.role } };
  }
  const u = localUser();
  if (!u) return { _s: 401, ok: false, error: "Login required" };
  if (p === "/data" && m === "GET") {
    const db = localDbInit();
    return { _s: 200, ok: true, data: db.data, ver: db.ver, me: { id: u.id, name: u.name, role: u.role }, users: db.users };
  }
  if (p === "/data" && m === "PUT") {
    const db = localDbInit();
    const base = Number(b && b.base);
    if (isFinite(base) && base !== db.ver) return { _s: 409, ok: false, conflict: true, data: db.data, ver: db.ver, error: "Data badal gaya" };
    db.data = Object.assign({}, b && b.data); db.ver += 1; db.updatedAt = nowIso();
    dbSaveLocal(db);
    return { _s: 200, ok: true, ver: db.ver };
  }
  if (p === "/users" && m === "PUT") {           // local user admin (super only)
    if (u.role !== "super") return { _s: 403, ok: false, error: "Sirf Super Admin" };
    const db = localDbInit();
    db.users = Object.assign(db.users, b && b.users); dbSaveLocal(db);
    return { _s: 200, ok: true, users: db.users };
  }
  if (p === "/auth/password" && m === "POST") {
    const db = localDbInit();
    const x = db.users[String(u.id)];
    if (!x) return { _s: 404, ok: false, error: "User nahi mila" };
    if (x.pw !== pwHash(String(u.id), String(b.old || ""))) return { _s: 400, ok: false, error: "Current password galat hai" };
    if (String(b.next || "").length < 6) return { _s: 400, ok: false, error: "Naya password kam se kam 6 characters ka ho" };
    x.pw = pwHash(String(u.id), b.next); dbSaveLocal(db);
    return { _s: 200, ok: true };
  }
  return { _s: 404, ok: false, error: "Not found" };
}

/* ---------------- HTTP API ---------------- */
async function api(m, p, b) {
  if (MODE === "local") return localApi(m, p, b);
  const h = { Accept: "application/json" };
  if (m !== "GET") h["Content-Type"] = "application/json";
  const t = localStorage.getItem(TOK);
  if (t && t.indexOf("local:") !== 0) h.Authorization = "Bearer " + t;
  let r;
  try {
    r = await fetch(cloudBase() + p, { method: m, headers: h, body: m === "GET" ? undefined : JSON.stringify(b), cache: "no-store" });
  } catch (e) {
    return { _s: 0, ok: false, error: "Server se connection nahi bana" };
  }
  let j = {};
  try { j = await r.json(); } catch (e) {}
  j._s = r.status; j.ok = r.ok;
  return j;
}

/* ---------------- data load / save ---------------- */
let USERS = {};
async function loadData() {
  const r = await api("GET", "/data");
  if (r.data) { D = r.data; migrate(); }
  if (r.users) USERS = r.users;
  if (r.me) ME = { id: r.me.id, name: r.me.name, role: r.me.role };
  VER = r.ver || VER;
  return r;
}
async function save() {
  migrate();
  const r = await api("PUT", "/data", { base: VER, data: D });
  if (r.ok) VER = r.ver;
  else if (r.conflict && r.data) { D = r.data; migrate(); VER = r.ver; toast("Data refresh hua — dobara try karein."); }
  else if (r._s !== 401) toast("Save nahi hua: " + (r.error || "unknown error"));
  return r;
}
/* save + re-render, the common mutation path */
function commit(msg) { save().then(() => { if (msg) toast(msg); }); }

/* ---------------- auth ---------------- */
function setToken(t) { t ? localStorage.setItem(TOK, t) : localStorage.removeItem(TOK); }
function isS() { return !!ME && ME.role === "super"; }

/* ---------------- dialog + toast ---------------- */
function dlg(html) { const d = document.getElementById("dlg"); d.innerHTML = html; d.showModal(); return d; }
function closeDlg() { const d = document.getElementById("dlg"); if (d.open) d.close(); }
function say(m) {
  const d = document.getElementById("dlg2");
  d.innerHTML = `<p>${esc(m)}</p><div class="acts"><button class="btn" id="ao">OK</button></div>`;
  $("#ao").onclick = () => d.close();
  d.showModal();
}
function ask(m, fn) {
  const d = document.getElementById("dlg2");
  d.innerHTML = `<p>${esc(m)}</p><div class="acts"><button class="btn g" id="an">Cancel</button><button class="btn red" id="ay">Yes, continue</button></div>`;
  $("#an").onclick = () => d.close();
  $("#ay").onclick = () => { d.close(); fn(); };
  d.showModal();
}
let toastT;
function toast(m) {
  const e = document.getElementById("toast");
  e.textContent = m; e.classList.add("on"); e.classList.add("ok");
  clearTimeout(toastT);
  toastT = setTimeout(() => e.classList.remove("on"), 2600);
}

/* ---------------- shared UI helpers ---------------- */
const empty = '<div class="empty">Abhi kuch nahi hai. Neeche se add karein.</div>';
const cut = arr => arr.length
  ? arr.slice(0, lim).join("") + (arr.length > lim ? `<button class="btn g" style="width:100%;margin-top:6px" onclick="lim+=100;upd()">Show more (${arr.length - lim})</button>` : "")
  : empty;
const kp = (h, v, c) => `<div class="stat"><b class="${c || ""}">${v}</b><span>${esc(h)}</span></div>`;
const pill = (t, c) => `<span class="pill ${c || ""}">${esc(t)}</span>`;
const cl = v => (+v < 0 ? "neg" : "pos");
const bar = (v, t, c) => `<div class="bar2"><i style="width:${t ? Math.max(0, Math.min(100, v / t * 100)) : 0}%;background:${c || "var(--ac)"}"></i></div>`;
const hd = t => `<h3 class="hd">${esc(t)}</h3>`;
const tbl = (heads, rows) => `<div class="tw"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("") || ""}</tbody></table></div>`;
const addB = (fn, label) => `<button class="btn" onclick="${fn}">${label}</button>`;

/* search box wired to the global query */
function sb(ph, extra) {
  return `<div class="bar"><input id="qbox" value="${esc(q)}" placeholder="${esc(ph)}" oninput="q=this.value.trim();upd()">${extra || ""}</div>`;
}
function qmatch(s) { return !q || String(s || "").toLowerCase().includes(q.toLowerCase()); }

/* company / manager lookups */
function cn(c) { const i = +String(c == null ? "" : c).trim(); const e = D.cos[i - 1]; return e ? e.m : ""; }
function cfull(c) { const i = +String(c == null ? "" : c).trim(); const e = D.cos[i - 1]; return e ? (e.n || e.m) : ""; }
function cosOn() { return D.cos.map((c, i) => ({ c: String(i + 1), m: c.m, n: c.n || c.m, x: c.x })).filter(o => !o.x); }
function copts(inclAll) {
  const list = cosOn().map(o => [o.c, o.m]);
  return inclAll ? [["0", "All managers"]].concat(list) : list;
}
function lopt(key, inclAll) {
  const list = (D.m[key] || []).map(v => [v, v]);
  return inclAll ? [["0", "All"]].concat(list) : list;
}

/* fiscal / period helpers bound to the current filters */
const inP = d => d && fyOf(d) === fy && (mn === "All" || mnOf(d) === mn);   // period (respects month filter)
const inF = d => d && fyOf(d) === fy;                                       // fiscal year only
const inScope = x => (co === "0" || String(x.c) === String(co)) && (br === "0" || !x.br || x.br === br);

/* expense / income money maths — same rules as the original sheet */
const gs = x => Math.round((+x.amt || 0) * (+x.g || 0) * 100) / 100;
const tot = x => (+x.amt || 0) + gs(x);
const paid = x => x.st === "Paid" ? tot(x) : x.st === "Partial" ? Math.min(+x.pp || 0, tot(x)) : 0;
const outs = x => x.ap === "Rejected" ? 0 : tot(x) - paid(x);
const dues = x => outs(x) <= 0 ? "Settled" : (x.due && x.due < today() ? "OVERDUE" : "Due");
const net = x => x.ap === "Rejected" ? 0 : +x.amt || 0;
const gcr = x => x.ap === "Rejected" ? 0 : gs(x);
const rin = x => x.st === "Pending" ? tot(x) : 0;
const sg = a => a.t === "g" ? +a.amt || 0 : a.t === "r" ? -(+a.amt || 0) : 0;

/* attendance aggregation for the current month + company */
function dmP() {
  const r = {};
  for (const k in D.a) {
    if (inP(k.slice(0, 10))) {
      const w = k.slice(11);
      r[w] = (r[w] || 0) + (D.a[k] === "P" ? 1 : D.a[k] === "H" ? 0.5 : 0);
    }
  }
  return r;
}
const wagesP = () => { const d = dmP(); return D.w.filter(w => co === "0" || String(w.c) === String(co)).reduce((t, w) => t + (d[w.id] || 0) * (+w.wg || 0), 0); };

/* worker fund transfer linkage */
const trAdv = t => sum(D.fa.filter(a => String(a.tr) === String(t.id) && String(a.c) === String(t.c)), "amt");

/* next ids */
const nextId = col => { const m = Math.max(0, ...D[col].map(r => +r.id || 0)); return Math.max(m + 1, +D.n || 1); };
function takeId() { const v = D.n || 1; D.n = v + 1; return v; }
