"use strict";
/**
 * End-to-end smoke test — real server + real client JS, no browser.
 *
 * Boots server.js on a free port with an isolated store, then runs the actual
 * js/*.js in a stub DOM in cloud mode so every screen talks to the live API.
 * Covers: login provisioning, pending approval, /users admin, /users/act,
 * password change, stale-token invalidation, CAS 409, every screen, and a
 * write that must land on the server.
 *
 * Usage: node test/smoke.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.SMOKE_PORT || 3411);
const BASE = "http://127.0.0.1:" + PORT;

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  ok   " + n); }
  else { fail++; console.log("  FAIL " + n + (extra !== undefined ? " -> " + extra : "")); }
};

/* ---------- helpers ---------- */
async function req(method, p, body, token) {
  const h = { Accept: "application/json" };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (token) h.Authorization = "Bearer " + token;
  const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
}

/* ---------- stub DOM ---------- */
const els = new Map();
const mk = id => ({
  id, _html: "", value: "", textContent: "", hidden: false, disabled: false, dataset: {}, style: {},
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
  get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
  showModal() { this.open = true; }, close() { this.open = false; },
  querySelectorAll() { return []; }, appendChild() {}, addEventListener() {}
});
const document = {
  readyState: "complete",
  getElementById(id) { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); },
  querySelector(s) { return s ? this.getElementById(String(s).replace(/^#/, "")) : null; },
  querySelectorAll() { return []; }, addEventListener() {},
  createElement(t) { const el = mk(t); el.click = () => { el.clicked = true; }; el.remove = () => {}; return el; },
  body: mk("body"), head: mk("head"),
  write() {}, close() {}
};
const lsStore = new Map();
const localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k)
};

const FILES = ["core.js", "accounting.js", "views-people.js", "views-money.js", "views-reports.js", "boot.js"];
const src = FILES.map(f => fs.readFileSync(path.join(ROOT, "js", f), "utf8")).join("\n");

/* the export helpers build blobs and click anchors — give them working stubs */
const URLStub = Object.assign({}, { createObjectURL: () => "blob:stub", revokeObjectURL: () => {} },
  { prototype: URL.prototype });
URLStub.createObjectURL = () => "blob:stub";
URLStub.revokeObjectURL = () => {};
const blobBytes = [];
const BlobStub = class {
  constructor(parts) { this.parts = parts; blobBytes.push(String((parts || []).join(""))); }
};

const ctx = {
  document, localStorage, fetch,
  URL: URLStub, URLSearchParams, console, setTimeout, clearTimeout,
  alert() {}, confirm: () => true,
  /* cloud mode: the panel must talk to the server, not localStorage */
  location: { reload() {}, hostname: "panel.example.com", protocol: "https:", search: "" },
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
  Blob: BlobStub,
  window: { open: () => null, scrollTo() {}, scrollY: 0 }
};
ctx.window.document = document; ctx.window.localStorage = localStorage; ctx.window.location = ctx.location;
vm.createContext(ctx);
const R = e => vm.runInContext(e, ctx);

/* ---------- isolated server ---------- */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jbb-smoke-"));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
      env: Object.assign({}, process.env, {
        PORT: String(PORT), STORE_MODE: "file",
        DATA_FILE: path.join(tmpDir, "store.json")   // never touch the repo's real data
      }),
      cwd: tmpDir, stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    const onData = d => {
      out += String(d);
      if (/running on/.test(out)) resolve(child);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", d => { out += String(d); });
    child.on("exit", c => { if (!/running on/.test(out)) reject(new Error("server exited " + c + "\n" + out)); });
    setTimeout(() => reject(new Error("server did not start\n" + out)), 15000);
  });
}

(async () => {
  console.log("Smoke test — live server + real client JS (" + BASE + ")");
  const srv = await startServer();

  try {
    /* ---------- HTTP contract ---------- */
    console.log("\n-- API contract --");
    let r = await req("GET", "/api/health");
    check("health responds", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));

    r = await req("POST", "/auth/login", { id: "boss@jbb.com", password: "boss12345" });
    check("first login provisions Super Admin", r.status === 200 && r.body.user.role === "super", JSON.stringify(r.body).slice(0, 120));
    const tok = r.body.token;

    r = await req("POST", "/auth/login", { id: "new@jbb.com", password: "new12345" });
    check("second account is pending, not auto-approved", r.status === 403 && /Approve/.test(r.body.error || ""), JSON.stringify(r.body));

    r = await req("GET", "/users", undefined, tok);
    check("GET /users lists accounts", r.status === 200 && Array.isArray(r.body.users) && r.body.users.length === 2, JSON.stringify(r.body).slice(0, 120));
    check("pending account is visible for approval", (r.body.users || []).some(u => u.status === "pending"));

    r = await req("GET", "/users", undefined, "garbage");
    check("GET /users rejects a bad token", r.status === 401);

    r = await req("POST", "/users/act", { uid: "new@jbb.com", act: "approve" }, tok);
    check("approve activates the account", r.status === 200 && r.body.user.status === "active", JSON.stringify(r.body));

    r = await req("POST", "/auth/login", { id: "new@jbb.com", password: "new12345" });
    check("approved account can log in", r.status === 200);
    const tok2 = r.body.token;

    r = await req("GET", "/users", undefined, tok2);
    check("non-super cannot read the user list", r.status === 403, JSON.stringify(r.body));

    r = await req("POST", "/users/act", { uid: "boss@jbb.com", act: "block" }, tok);
    check("super admin cannot block themselves", r.status === 400, JSON.stringify(r.body));

    r = await req("POST", "/users/act", { uid: "new@jbb.com", act: "block" }, tok);
    check("block works", r.status === 200 && r.body.user.status === "blocked");

    r = await req("GET", "/data", undefined, tok2);
    check("blocked account's token stops working", r.status === 401, JSON.stringify(r.body));

    r = await req("POST", "/auth/password", { old: "wrong", next: "zzzz1234" }, tok);
    check("password change needs the current password", r.status === 400);
    r = await req("POST", "/auth/password", { old: "boss12345", next: "zzzz1234" }, tok);
    check("password change succeeds and rotates the token", r.status === 200 && !!r.body.token);
    r = await req("GET", "/data", undefined, tok);
    check("old token is invalidated by the password change", r.status === 401);

    const tok3 = (await req("POST", "/auth/login", { id: "boss@jbb.com", password: "zzzz1234" })).body.token;
    check("new password logs in", !!tok3);

    r = await req("GET", "/data", undefined, tok3);
    check("GET /data returns the seeded document", r.status === 200 && Array.isArray(r.body.data.w) && r.body.data.w.length >= 3, "ver " + r.body.ver);
    const d0 = r.body;

    r = await req("PUT", "/data", { base: 999, data: { w: [] } }, tok3);
    check("stale base is rejected with 409", r.status === 409 && r.body.conflict === true, JSON.stringify(r.body).slice(0, 100));

    r = await req("PUT", "/data", { base: d0.ver, data: Object.assign({}, d0.data, { w: d0.data.w.concat([{ id: 9001, n: "HTTP Worker", wg: 555, c: "1", r: "Helper" }]) }) }, tok3);
    check("PUT /data accepts a matching base", r.status === 200 && r.body.ver > d0.ver, JSON.stringify(r.body));

    r = await req("GET", "/data", undefined, tok3);
    check("write round-trips", r.body.data.w.some(w => w.n === "HTTP Worker"));

    /* ---------- client on the live API ---------- */
    console.log("\n-- client against live server --");
    /* load the real client, then point it at the test server */
    vm.runInContext(src, ctx, { filename: "panel.js" });
    R('setPrefs({mode:"cloud",cloudBase:' + JSON.stringify(BASE) + '});MODE="cloud"');

    const login = await R('api("POST","/auth/login",{id:"boss@jbb.com",password:"zzzz1234"})');
    check("client login hits the real server", login._s === 200 && login.user.role === "super", JSON.stringify(login).slice(0, 100));
    R('localStorage.setItem("bm_tok",' + JSON.stringify(login.token) + ')');
    R('ME=' + JSON.stringify(login.user));
    const ld = await R("loadData()");
    check("loadData pulls from the server", ld._s === 200 && ld.data.w.some(w => w.n === "HTTP Worker"), "ver " + ld.ver);

    /* every screen must render with real server data */
    console.log("\n-- screens (live data) --");
    for (const t of ["dash", "work", "att", "adv", "fund", "pay", "sa", "ex", "inc", "bud", "mgr", "rep"]) {
      try {
        R(`tab='${t}';q='';lim=200;render()`);
        const html = els.get("screen").innerHTML || "";
        const dirty = />undefined</.test(html) || /NaN/.test(html) || /\[object Object\]/.test(html);
        check("'" + t + "' renders cleanly", html.length > 100 && !dirty, dirty ? "undefined/NaN present" : "len " + html.length);
      } catch (e) {
        check("'" + t + "' renders cleanly", false, e.message);
      }
    }

    /* a UI write must reach the server */
    console.log("\n-- write path --");
    const n0 = R("D.w.length");
    R('D.w.push({id:9002,n:"Via Panel",c:"1",wg:321,r:"Helper"})');
    const sv = await R("save()");
    check("save() writes through to the server", sv.ok === true, JSON.stringify(sv));
    const after = await req("GET", "/data", undefined, tok3);
    check("server sees the panel write", after.body.data.w.some(w => w.n === "Via Panel" && w.wg === 321));
    check("version advanced past the original", after.body.ver > d0.ver);
    check("worker count grew by one", after.body.data.w.length === n0 + 1, after.body.data.w.length + " vs " + (n0 + 1));

    /* user admin from the UI */
    console.log("\n-- user admin screen --");
    R('ME.role="super";settings()');
    await R("renderUsers()");
    const box = els.get("usr").innerHTML || "";
    check("user list renders", box.length > 50 && /boss@jbb\.com/.test(box), "len " + box.length);
    check("approve/block buttons present", /userAct/.test(box));
    await R('userAct("new@jbb.com","unblock")');
    const u2 = await req("GET", "/users", undefined, tok3);
    check("unblock through the UI reaches the server", (u2.body.users || []).find(u => u.id === "new@jbb.com").status === "active");

    /* exports must not need a network or a library */
    console.log("\n-- exports --");
    const csvOk = (() => { try { R("csvFile('test',['Name','Amount'],[['Ram','1,200']])"); return true; } catch (e) { return e.message; } })();
    check("csvFile builds and downloads a CSV", csvOk === true, csvOk);
    const csv = blobBytes[blobBytes.length - 1] || "";
    check("CSV starts with a BOM for Excel", csv.charCodeAt(0) === 0xfeff);
    check("CSV quotes and escapes values", /"Name","Amount"/.test(csv) && /"Ram","1,200"/.test(csv), JSON.stringify(csv.slice(0, 60)));
    check("printReport opens a print window", (() => {
      try { R('printReport("Report","<p>x</p>")'); return true; } catch (e) { return e.message; }
    })() === true);

    console.log("\n" + pass + " passed, " + fail + " failed");
  } finally {
    srv.kill("SIGTERM");
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
