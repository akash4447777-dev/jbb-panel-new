"use strict";
/**
 * Offline-mode test — no server involved.
 * Runs index.html's real client JS in a stub DOM with MODE forced to "local",
 * proving the panel works on static hosting (GitHub Pages) with localStorage only.
 *
 * Usage: node test/offline.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const clientJs = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");

/* ---------------- stub DOM ---------------- */
const els = new Map();
function makeEl(id) {
  return {
    id, _html: "", value: "", textContent: "", hidden: false, disabled: false,
    dataset: {}, style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    showModal() { this.open = true; }, close() { this.open = false; },
    querySelectorAll() { return []; }, appendChild() {}, addEventListener() {}
  };
}
const document = {
  readyState: "complete",
  getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
  querySelector(sel) { return this.getElementById(sel.replace(/^#/, "")); },
  querySelectorAll() { return []; }, addEventListener() {},
  createElement(t) { return makeEl("new-" + t); },
  body: makeEl("body"), head: makeEl("head")
};

// persistent localStorage across context reloads, like a real browser
const lsMap = new Map();
const localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => lsMap.set(k, String(v)),
  removeItem: (k) => lsMap.delete(k)
};

const ctx = {
  document, localStorage,
  fetch: () => { throw new Error("offline mode must not touch the network"); },
  URL, console, setTimeout, clearTimeout,
  alert: (m) => console.log("[alert]", m), confirm: () => true,
  location: { reload() {}, hostname: "example.github.io", protocol: "https:" },
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error
};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(clientJs, ctx, { filename: "index.html<script>" });

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

(async () => {
  console.log("Offline mode test (static hosting path)");

  // auto-detection on *.github.io must pick local mode
  check("auto-detects offline mode on github.io", vm.runInContext("MODE", ctx) === "local");

  // login with no network at all
  ctx.showLogin();
  check("login screen renders", els.get("screen").innerHTML.includes("JBB PANEL"));
  check("login screen says offline", /Offline mode/.test(els.get("screen").innerHTML));

  document.getElementById("l-id").value = "worker@jbb.com";
  document.getElementById("l-pw").value = "jbb1234";
  await ctx.login();
  check("login works with zero network calls", (localStorage.getItem("bm_tok") || "").startsWith("local:"));
  check("first user becomes Admin", /Admin/.test(els.get("hdr").innerHTML));

  // seeded demo data must be visible
  const workersHtml = (() => { ctx.setTab("work"); return els.get("screen").innerHTML; })();
  check("demo workers loaded from localStorage", /Ramesh Kumar/.test(workersHtml));
  ctx.setTab("dash");
  check("dashboard totals render", /₹/.test(els.get("screen").innerHTML));

  // all tabs render
  for (const t of ["dash", "work", "adv", "ex", "inc", "sa", "att", "bud", "co"]) {
    try {
      ctx.setTab(t);
      const out = els.get("screen").innerHTML || "";
      check("tab '" + t + "' renders", out.length > 40 && !/>undefined</.test(out) && !/NaN/.test(out));
    } catch (e) {
      fail++; console.log("  FAIL tab '" + t + "' threw: " + e.message);
    }
  }

  // write -> persists to localStorage
  ctx.setTab("work");
  const before = JSON.parse(localStorage.getItem("jbb_local_db")).data.w.length;
  ctx.addWorker();
  document.getElementById("a-name").value = "Offline Worker";
  document.getElementById("a-wage").value = "650";
  document.getElementById("a-save").onclick();
  await new Promise((r) => setTimeout(r, 60));
  const db = JSON.parse(localStorage.getItem("jbb_local_db"));
  check("add worker persisted to localStorage",
    db.data.w.length === before + 1 && db.data.w.some((w) => w.n === "Offline Worker" && w.wg === 650));
  check("version incremented", db.ver > 0);

  // data survives a fresh page load (new context, same localStorage)
  const ctx2 = Object.assign({}, ctx);
  delete ctx2.window;
  vm.createContext(ctx2);
  ctx2.window = ctx2;
  vm.runInContext(clientJs, ctx2, { filename: "reload" });
  check("auto-login after reload keeps session",
    vm.runInContext('(localStorage.getItem("bm_tok")||"").startsWith("local:")', ctx2));
  const reloaded = vm.runInContext('JSON.stringify((locLoad()||{}).data ? locLoad().data.w.map(w=>w.n) : [])', ctx2);
  check("worker survives page reload", reloaded.includes("Offline Worker"));

  // conflict protection still works offline (ctx2 has no token, so authenticate first)
  vm.runInContext('localStorage.setItem("bm_tok","local:worker@jbb.com")', ctx2);
  const stale = await vm.runInContext('localApi("PUT","/data",{base:0,data:{}})', ctx2);
  check("stale write rejected with 409", stale._s === 409 && stale.conflict === true);

  // wrong password rejected
  localStorage.removeItem("bm_tok");
  const bad = await vm.runInContext('localApi("POST","/auth/login",{id:"worker@jbb.com",password:"nope"})', ctx2);
  check("wrong password rejected offline", bad._s === 401 && /galat/.test(bad.error));

  // backup export/restore
  // load D from the store first, exactly like start() does
  vm.runInContext('D=locLoad().data; VER=locLoad().ver; fixD();', ctx2);
  const backupJson = vm.runInContext('JSON.stringify({app:"jbb-panel",data:strip(D)})', ctx2);
  check("backup payload contains data", backupJson.includes('"adv"') && backupJson.includes('"w"'));
  const parsed = JSON.parse(backupJson);
  check("backup has advances", Array.isArray(parsed.data.adv) && parsed.data.adv.length > 0);
  check("backup export fn exists", vm.runInContext('typeof exportBackup==="function"', ctx2));
  check("backup import fn exists", vm.runInContext('typeof importBackup==="function"', ctx2));

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
