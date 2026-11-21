"use strict";
/**
 * UI smoke test — runs index.html's real client JS in a stub DOM against a live server.
 * Usage: node test/smoke.js   (server must be running on PORT, default 3000)
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const BASE = process.env.BASE || "http://127.0.0.1:" + (process.env.PORT || 3000);

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const clientJs = scripts.join("\n");

/* ---------------- stub DOM ---------------- */
const store = new Map();
let innerHTMLWrites = 0;

function makeEl(id) {
  return {
    id,
    _html: "",
    value: "",
    textContent: "",
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); innerHTMLWrites++; },
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelectorAll() { return []; },
    appendChild() {},
    addEventListener() {}
  };
}

const document = {
  readyState: "complete",
  getElementById(id) {
    if (!store.has(id)) store.set(id, makeEl(id));
    return store.get(id);
  },
  querySelector(sel) {
    const id = sel.replace(/^#/, "");
    return this.getElementById(id);
  },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement(t) { return makeEl("new-" + t); },
  body: makeEl("body"),
  head: makeEl("head")
};

const ls = new Map();
const localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};

const errors = [];
const ctx = {
  document,
  localStorage,
  fetch: (u, o) => fetch(new URL(u, BASE), o),
  URL,
  console,
  setTimeout,
  clearTimeout,
  alert: (m) => console.log("[alert]", m),
  confirm: () => true,
  location: { reload() {} },
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error
};
ctx.window = ctx;
ctx.globalThis = ctx;

vm.createContext(ctx);
try {
  vm.runInContext(clientJs, ctx, { filename: "index.html<script>" });
} catch (e) {
  console.error("FATAL: client script threw on load:", e.message);
  process.exit(1);
}

/* ---------------- helpers ---------------- */
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

(async () => {
  console.log("Target: " + BASE);

  const health = await (await fetch(BASE + "/api/health")).json();
  check("server health", health.ok === true);
  console.log("  (store ver " + health.ver + ", users " + health.users + ")");

  // clean slate: clear any saved token then log in through the real UI function
  localStorage.removeItem("bm_tok");
  ctx.showLogin();
  const loginHtml = store.get("screen").innerHTML;
  check("login screen renders", loginHtml.includes("JBB PANEL") && loginHtml.includes("l-id"));

  document.getElementById("l-id").value = "smoke@test.com";
  document.getElementById("l-pw").value = "smoke1234";
  await ctx.login();

  const tok = localStorage.getItem("bm_tok");
  check("login stored a token", !!tok && tok.length > 40);
  check("identity populated (hdr shows real name)", /smoke/.test(store.get("hdr").innerHTML));
  check("no login error shown", !store.get("l-err").classList.contains("on"));

  // wrong password path
  document.getElementById("l-pw").value = "totally-wrong";
  await ctx.login();
  check("bad password shows an error message", store.get("l-err").classList.contains("on") &&
    store.get("l-err").textContent.length > 0);
  document.getElementById("l-pw").value = "smoke1234";
  await ctx.login();

  // every tab must render without throwing
  const tabs = ["dash", "work", "adv", "ex", "inc", "sa", "att", "bud", "co"];
  for (const t of tabs) {
    try {
      ctx.setTab(t);
      const out = store.get("screen").innerHTML || "";
      check("tab '" + t + "' renders (" + out.length + " bytes)", out.length > 40);
      check("tab '" + t + "' has no undefined text", !/>undefined</.test(out) && !/NaN/.test(out));
    } catch (e) {
      fail++;
      console.log("  FAIL tab '" + t + "' threw: " + e.message);
      errors.push(e);
    }
  }

  // data actually round-trips through the server
  const before = (await (await fetch(BASE + "/data", { headers: { Authorization: "Bearer " + tok } })).json());
  check("GET /data returns seeded workers", Array.isArray(before.data.w) && before.data.w.length >= 3);
  check("GET /data returns companies", Array.isArray(before.data.cos) && before.data.cos.length >= 1);

  // add a worker through the UI, verify it lands on the server
  const n0 = before.data.w.length;
  ctx.addWorker();
  document.getElementById("a-name").value = "Smoke Test Worker";
  document.getElementById("a-wage").value = "777";
  const saveP = document.getElementById("a-save").onclick();
  await saveP;
  await new Promise((r) => setTimeout(r, 400));
  const after = await (await fetch(BASE + "/data", { headers: { Authorization: "Bearer " + tok } })).json();
  check("worker added via UI persisted to server", after.data.w.length === n0 + 1 &&
    after.data.w.some((w) => w.n === "Smoke Test Worker" && w.wg === 777));
  check("version incremented on save", after.ver > before.ver);

  // currency formatting
  check("currency renders ₹ prefix", ctx.num(1234) === "₹1,234" || ctx.num(1234) === "₹1234" || ctx.num(1234).startsWith("₹"));
  // `jsq` is a top-level const, so evaluate it inside the context rather than on ctx
  const quote = String.fromCharCode(39);
  const jsqOut = vm.runInContext("jsq(" + JSON.stringify("a" + quote + "b") + ")", ctx);
  check("jsq escapes single quotes", jsqOut === "&#39;a\\&#39;b&#39;"); // escaped quote keeps its backslash

  // document shape sanity for the settlement undo path
  ctx.setTab("sa");
  check("settlements tab handles empty history", /Settlement data nahi hai/.test(store.get("screen").innerHTML));

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
