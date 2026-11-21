"use strict";
/**
 * Panel logic tests — runs the real client JS in a stub DOM, no browser.
 * Covers money maths, the worker ledger, settlement/undo, period filters,
 * ageing, GST, payroll, every screen rendering, and persistence.
 *
 * Usage: node test/panel.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const FILES = ["core.js", "accounting.js", "views-people.js", "views-money.js", "views-reports.js", "boot.js"];
const src = FILES.map(f => fs.readFileSync(path.join(ROOT, "js", f), "utf8")).join("\n");

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
  createElement(t) { return mk(t); }, body: mk("body"), head: mk("head"),
  write() {}, close() {}
};
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
const ctx = {
  document, localStorage,
  fetch: () => { throw new Error("offline mode must not touch the network"); },
  URL, URLSearchParams, console, setTimeout, clearTimeout,
  alert() {}, confirm: () => true,
  location: { reload() {}, hostname: "akash4447777-dev.github.io", protocol: "https:", search: "" },
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map,
  Blob: class { constructor() {} },
  window: { open: () => null, scrollTo() {}, scrollY: 0 }
};
ctx.window.document = document; ctx.window.localStorage = localStorage; ctx.window.location = ctx.location;
vm.createContext(ctx);
try {
  vm.runInContext(src, ctx, { filename: "panel.js" });
} catch (e) {
  console.error("FATAL: client code threw on load:", e.message);
  process.exit(1);
}
const R = e => vm.runInContext(e, ctx);

let pass = 0, fail = 0;
const ck = (n, c, ex) => { if (c) { pass++; console.log("  ok   " + n); } else { fail++; console.log("  FAIL " + n + (ex !== undefined ? " -> " + ex : "")); } };

(async () => {
  console.log("Panel logic (offline mode, no browser)");
  ck("offline mode auto-detected on github.io", R("MODE") === "local");

  /* real login flow, then load */
  const login = await R('localApi("POST","/auth/login",{id:"owner@jbb.com",password:"jbb12345"})');
  ck("first account is Super Admin", login._s === 200 && login.user.role === "super", JSON.stringify(login).slice(0, 90));
  R('localStorage.setItem("bm_tok",' + JSON.stringify(login.token) + ')');
  R('ME={id:"owner@jbb.com",name:"owner",role:"super"}');
  const lr = await R("loadData()");
  ck("data loads from localStorage", lr._s === 200 && lr.data.w.length === 5, "w=" + (lr.data.w || []).length);

  /* ---------- money maths ---------- */
  /* ---------- legacy data compatibility ---------- */
  console.log("\n-- legacy data (old panel shape) --");
  const legacy = {
    n: 50, cos: [{ m: "OLD MANAGER", x: true }, { m: "SECOND", x: false }],
    w: [{ id: 7, n: "Old Worker", c: "1", wg: 400 }],            // no "r"
    adv: [{ id: 8, d: "2026-04-02", w: 7, t: "g", amt: 1500 }],  // no note
    ex: [{ id: 9, no: 1, d: "2026-04-03", c: "1", cat: "Miscellaneous", v: "Old Vendor", amt: 500 }], // no br/dp/sub/g/st/ap/md
    inc: [{ id: 10, no: 1, d: "2026-04-04", c: "1", src: "Retail Sales", amt: 900 }],
    a: { "2026-04-05|7": "P" }, t: {}, u: [], s: [], sh: [], nl: {},
    mp: [], fa: [], bud: { cat: {}, mgr: {} }
  };
  R("D=" + JSON.stringify(legacy) + ";migrate()");
  ck("boolean x converted to 0/1", R('D.cos[0].x') === 1 && R('D.cos[1].x') === 0, R('JSON.stringify(D.cos.map(c=>c.x))'));
  ck("company display name filled", R('!!D.cos[0].n'));
  ck("missing master lists restored", R('D.m.br.length') > 0 && R('D.m.cat.length') > 0);
  ck("old worker keeps working", R('D.w[0].wg') === 400 && R('D.w[0].r') === "");
  ck("old advance gets a note field", R('D.adv[0].note') === "");
  ck("old expense gets defaults", R('D.ex[0].st') === "Paid" && R('D.ex[0].ap') === "Approved" && R('D.ex[0].g') === 0 && R('D.ex[0].br') !== null);
  ck("old income gets defaults", R('D.inc[0].st') === "Received" && R('D.inc[0].g') === 0);
  ck("old attendance preserved", R('D.a["2026-04-05|7"]') === "P");
  ck("old balance computes", R('bal(7,"9999-12-31")') === 1500, R('bal(7,"9999-12-31")'));
  /* budget view with an old-shape dataset */
  const budgetData = {
    n: 5, nx: 2, ni: 1,
    cos: [{ m: "OLD", n: "OLD", x: 0 }],
    m: { cat: ["Miscellaneous"], sub: { Miscellaneous: [] }, dep: ["Ops"], br: ["Shop"], md: ["Cash"], src: ["Sales"], gst: [0] },
    w: [], adv: [], inc: [], a: {}, t: {}, u: [], s: [], sh: [], nl: {}, mp: [], fa: [],
    ex: [{ id: 1, no: 1, d: R("today()"), c: "1", cat: "Miscellaneous", v: "V", amt: 4000, g: 0, st: "Paid", ap: "Approved" }],
    bud: { cat: { Miscellaneous: 10000 }, mgr: {} }
  };
  R("D=" + JSON.stringify(budgetData) + ";migrate()");
  R('fy=fyOf(today());mn="All";co="0";br="0"');
  ck("legacy rows render in budget view", (() => { try { R("tab='bud';render()"); return (els.get("screen").innerHTML || "").length > 100; } catch (e) { return e.message; } })() === true);

  /* restore the seeded dataset + a valid session for the rest of the suite */
  R("localStorage.removeItem('jbb_db_v3');localStorage.removeItem('bm_tok');D=migrate();localDbInit()");
  const relog = await R('localApi("POST","/auth/login",{id:"owner@jbb.com",password:"jbb12345"})');
  R('localStorage.setItem("bm_tok",' + JSON.stringify(relog.token) + ')');
  R('ME={id:"owner@jbb.com",name:"owner",role:"super"}');
  await R("loadData()");
  R('fy=fyOf(today());mn="All";co="0";br="0"');

  /* ---------- upgrading an existing panel install ---------- */
  console.log("\n-- upgrading an existing install --");
  const oldInstall = {
    ver: 9,
    data: {
      n: 3, nx: 2, ni: 2,
      cos: [{ m: "JBB CONSTRUCTIONS" }, { m: "SECOND CO" }],
      w: [{ id: 1, n: "Old Ramesh", c: "1", wg: 500 }],
      adv: [], ex: [], inc: [], mp: [], fa: [], a: {}, t: {}, s: [], sh: [], nl: {},
      bud: { cat: {}, mgr: [] }
    },
    users: {}, createdAt: "2025-01-01T00:00:00Z"
  };
  R("localStorage.setItem('jbb_db_v3'," + JSON.stringify(JSON.stringify(oldInstall)) + ")");
  R("localStorage.removeItem('bm_tok')");
  const upLogin = await R('localApi("POST","/auth/login",{id:"owner@jbb.com",password:"mypass123"})');
  R('localStorage.setItem("bm_tok",' + JSON.stringify(upLogin.token) + ')');
  const up = await R("loadData()");
  ck("an existing install keeps its version", up.ver === 9, up.ver);
  ck("existing workers survive the upgrade", up.data.w.some(w => w.n === "Old Ramesh" && w.wg === 500));
  ck("existing companies survive", up.data.cos.length === 2 && up.data.cos[0].m === "JBB CONSTRUCTIONS");
  ck("companies get a display name and x flag", up.data.cos[0].n === "JBB CONSTRUCTIONS" && up.data.cos[0].x === 0);
  ck("array budgets become an object", !Array.isArray(up.data.bud.mgr));
  ck("master lists fill in where missing", up.data.m.cat.length > 0 && up.data.m.br.length > 0);
  ck("upgraded data renders", (() => {
    try { R('tab="work";render()'); return /Old Ramesh/.test(els.get("screen").innerHTML || ""); } catch (e) { return e.message; }
  })() === true);

  /* back to a clean seeded install for the rest of the suite */
  R("localStorage.removeItem('jbb_db_v3');localStorage.removeItem('bm_tok');D=migrate();localDbInit()");
  const reseed = await R('localApi("POST","/auth/login",{id:"owner@jbb.com",password:"jbb12345"})');
  R('localStorage.setItem("bm_tok",' + JSON.stringify(reseed.token) + ')');
  R('ME={id:"owner@jbb.com",name:"owner",role:"super"}');
  await R("loadData()");
  R('fy=fyOf(today());mn="All";co="0";br="0"');

  /* ---------- adopting the FIRST panel's dataset (jbb_local_db) ---------- */
  console.log("\n-- adopting the first panel's data --");
  const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const firstPanel = {
    ver: 7,
    createdAt: "2025-06-01T00:00:00Z",
    users: { "ramesh@jbb.com": { id: "ramesh@jbb.com", name: "ramesh", role: "super", status: "active", pw: "h1abc.12" } },
    data: {
      w: [
        { id: 1, n: "Ramesh Kumar", c: "1", wg: 550, r: "Mason", ph: "9810012345", em: "ramesh@example.com" },
        { id: 2, n: "Suresh Yadav", c: "1", wg: 500, r: "Helper", ph: "9810012346", em: "" }
      ],
      adv: [{ id: 1, d: daysAgo(9), w: 1, t: "g", amt: 5000, note: "Ghar ke liye" },
            { id: 2, d: daysAgo(3), w: 1, t: "r", amt: 2000, note: "Wapas kiya" }],
      /* the crucial bit: old rows use `v` for the vendor, which collides with
         this panel's `v` = GST rate */
      ex: [{ id: 1, no: 1, d: daysAgo(10), v: "Sharma Cement Store", cat: "Material", c: "1", amt: 48500, ds: "INV-2201" }],
      inc: [{ id: 1, no: 1, d: daysAgo(8), v: "Mehra Builders", cat: "Contract", c: "1", amt: 150000, ds: "RC-551" }],
      mp: [], fa: [], sh: [], nl: {},
      a: { "2026-11-20|1": "P", "2026-11-20|2": "H", "2026-11-19|1": "A" },
      t: [], s: [],
      cos: [{ m: "JBB Constructions", x: false }, { m: "JBB Infra", x: false }],
      bud: { cat: { Material: 200000, Transport: 50000 }, mgr: [250000, 150000] }
    }
  };
  R("localStorage.removeItem('jbb_db_v3');localStorage.removeItem('bm_tok')");
  R("localStorage.setItem('jbb_local_db'," + JSON.stringify(JSON.stringify(firstPanel)) + ")");
  R("localStorage.setItem('jbb_prefs'," + JSON.stringify(JSON.stringify({ mode: "local" })) + ")");

  /* a returning user opens the panel with no session: the panel must adopt the
     old store, then their saved token resolves against it */
  R("localDbInit()");                                  /* what boot() does first */
  const oldTok = R("(function(){const db=dbLoadLocal();const k=Object.keys(db.users)[0];return 'local:'+k})()");
  R("localStorage.setItem('bm_tok'," + JSON.stringify(oldTok) + ")");
  const adopted = await R("loadData()");
  ck("the old dataset is picked up automatically", adopted._s === 200 && adopted.ver === 7, adopted._s + "/" + adopted.ver);
  const A = adopted.data;
  ck("workers carried over", A.w.length === 2 && A.w[0].n === "Ramesh Kumar");
  ck("worker mobile and email are not dropped", A.w[0].ph === "9810012345" && A.w[0].em === "ramesh@example.com");
  ck("expense vendor survives the v collision", A.ex[0].v === "Sharma Cement Store" && A.ex[0].vendor === "Sharma Cement Store", JSON.stringify(A.ex[0]).slice(0, 80));
  ck("expense GST is a rate, not the vendor name", A.ex[0].g === 0);
  ck("expense gets payment defaults", A.ex[0].st === "Paid" && A.ex[0].ap === "Approved");
  ck("invoice is lifted out of the detail field", A.ex[0].inv === "INV-2201", A.ex[0].inv);
  ck("income payer becomes party", A.inc[0].party === "Mehra Builders", A.inc[0].party);
  ck("income gets a source and status", !!A.inc[0].src && A.inc[0].st === "Received");
  ck("free-text categories join the master list", ["Material", "Contract"].every(c => A.m.cat.includes(c)), A.m.cat.slice(-3).join(","));
  ck("manager budgets keep their amounts", A.bud.mgr["1"] === 250000 && A.bud.mgr["2"] === 150000, JSON.stringify(A.bud.mgr));
  ck("category budgets carried over", A.bud.cat.Material === 200000);
  ck("manager flags survive", A.cos.length === 2 && A.cos[0].x === 0);
  ck("attendance is preserved verbatim", A.a["2026-11-20|1"] === "P" && A.a["2026-11-19|1"] === "A");
  ck("advance balance still computes", R('bal(1,"9999-12-31")') === 3000, R('bal(1,"9999-12-31")'));
  ck("the old key is left untouched", R("!!localStorage.getItem('jbb_local_db')") === true);

  /* the migrated rows must actually be visible in the UI */
  R("ME={id:'ramesh@jbb.com',name:'ramesh',role:'super'}");
  R('fy=fyOf(today());mn="All";co="0";br="0";gm=today().slice(0,7)');
  ck("workers screen shows the old worker", (() => { try { R('tab="work";render()'); return /Ramesh Kumar/.test(els.get("screen").innerHTML); } catch (e) { return e.message; } })() === true);
  ck("workers screen shows their contact details", /9810012345/.test(els.get("screen").innerHTML || ""));
  ck("expenses screen shows the old vendor", (() => { try { R('tab="ex";render()'); return /Sharma Cement Store/.test(els.get("screen").innerHTML); } catch (e) { return e.message; } })() === true);
  ck("income screen shows the old payer", (() => { try { R('tab="inc";render()'); return /Mehra Builders/.test(els.get("screen").innerHTML); } catch (e) { return e.message; } })() === true);
  ck("advances list shows the old advance", (() => { try { R('tab="adv";av="l";render()'); return /Ghar ke liye/.test(els.get("screen").innerHTML); } catch (e) { return e.message; } })() === true);

  /* running the adoption twice must not duplicate or corrupt anything */
  R("migrateFrom(dbLoadLocal());dbSaveLocal(dbLoadLocal())");
  const again = await R("loadData()");
  ck("re-running the upgrade is idempotent", again.data.w.length === 2 && again.data.ex.length === 1 && again.data.ex[0].v === "Sharma Cement Store");

  /* back to a clean seeded install */
  R("localStorage.removeItem('jbb_db_v3');localStorage.removeItem('jbb_local_db');localStorage.removeItem('bm_tok');D=migrate();localDbInit()");
  const reseed1 = await R('localApi("POST","/auth/login",{id:"owner@jbb.com",password:"jbb12345"})');
  R('localStorage.setItem("bm_tok",' + JSON.stringify(reseed1.token) + ')');
  R('ME={id:"owner@jbb.com",name:"owner",role:"super"}');
  await R("loadData()");
  R('fy=fyOf(today());mn="All";co="0";br="0";gm=today().slice(0,7);av="s"');

  console.log("\n-- money maths --");
  ck("GST 18% on 1000 = 180", R('gs({amt:1000,g:0.18})') === 180, R('gs({amt:1000,g:0.18})'));
  ck("gross = 1180", R('tot({amt:1000,g:0.18})') === 1180);
  ck("Paid pays gross", R('paid({amt:1000,g:0.18,st:"Paid"})') === 1180);
  ck("Partial capped at part-paid", R('paid({amt:1000,g:0,st:"Partial",pp:400})') === 400);
  ck("outstanding correct", R('outs({amt:1000,g:0,st:"Partial",pp:400})') === 600);
  ck("rejected is excluded", R('net({amt:1000,g:0.18,ap:"Rejected"})') === 0);
  ck("pending income is receivable", R('rin({amt:1000,g:0.18,st:"Pending"})') === 1180);

  /* ---------- worker ledger ---------- */
  console.log("\n-- worker ledger --");
  R('D.adv.push({id:901,d:today(),w:1,t:"n",amt:7777})');
  ck("jama (n) is never counted", R('bal(1,"9999-12-31")') === 3000, R('bal(1,"9999-12-31")'));
  R('D.adv=D.adv.filter(x=>x.id!==901)');
  ck("given minus returned = 3000", R('bal(1,"9999-12-31")') === 3000, R('bal(1,"9999-12-31")'));
  ck("events carry a running balance", R('workerEvents(1).every(e=>typeof e.balance==="number")'));
  ck("as-of balance works", R('bal(1,' + JSON.stringify(R("today()")) + ')') === 3000);

  /* ---------- settlement + undo ---------- */
  console.log("\n-- settlement --");
  const st = R('settleWorker(1,"2000-01-01",today(),0,"test")');
  ck("settlement succeeds", st.ok === true, JSON.stringify(st));
  ck("carry equals the balance", st.carry === 3000, st.carry);
  ck("NIL record written", R('!!D.nl["1|"+today()]'));
  ck("history row appended", R("D.sh.length") === 1);
  /* NIL settlement closes the period and carries the debt forward — it does not write it off */
  ck("balance carries forward unchanged", R('bal(1,"9999-12-31")') === 3000, R('bal(1,"9999-12-31")'));
  ck("carry is recorded on the NIL row", R('D.nl["1|"+today()].carry') === 3000);
  ck("settled amount is tracked", R('workerEvents(1).filter(e=>e.o).reduce((n,e)=>n+e.settled,0)') >= 0);
  const sid = R("D.sh[0].id");
  const un = R("undoSettlement(" + JSON.stringify(sid) + ")");
  ck("undo succeeds", un.ok === true, JSON.stringify(un));
  ck("balance restored after undo", R('bal(1,"9999-12-31")') === 3000, R('bal(1,"9999-12-31")'));
  ck("history row kept as REVERSED", R("D.sh[0].status") === "REVERSED");

  /* deductions reduce the carried debt */
  const st2 = R('settleWorker(2,"2000-01-01",today(),1000,"part pay")');
  ck("deduction reduces the carried balance", st2.carry === 2000, JSON.stringify(st2));
  ck("balance reflects the deduction", R('bal(2,"9999-12-31")') === 2000, R('bal(2,"9999-12-31")'));
  R("undoSettlement(" + JSON.stringify(st2.id) + ")");

  /* deducting the full balance settles it to zero */
  const st3 = R('settleWorker(3,"2000-01-01",today(),7500,"full")');
  ck("full deduction zeroes the balance", st3.carry === 0 && R('bal(3,"9999-12-31")') === 0, JSON.stringify(st3));
  R("undoSettlement(" + JSON.stringify(st3.id) + ")");

  /* ---------- period filters ---------- */
  console.log("\n-- period filters --");
  ck("inP accepts today in current FY", R('(()=>{fy=fyOf(today());mn="All";return inP(today())})()') === true);
  ck("inP rejects another FY", R('(()=>{fy="FY 1999-00";return inP(today())})()') === false);
  R('fy=fyOf(today());mn="All"');

  /* ---------- ageing / GST ---------- */
  console.log("\n-- ageing / GST --");
  ck("ageing produces rows", R("ageing().length") > 0);
  const bk = R("JSON.stringify(ageingBuckets(ageing()))");
  ck("buckets are clean numbers", !/null|undefined|NaN/.test(bk), bk);
  const gst = R("JSON.stringify(gstSummary(fyStartDate(fy),fyEndDate(fy)))");
  ck("GST summary has no NaN", !/NaN|null/.test(gst));
  const gs2 = R('JSON.stringify(gstSummary(fyStartDate(fy),fyEndDate(fy)).rows)');
  ck("GST rows keyed by rate", /"rate"/.test(gs2));

  /* ---------- payroll ---------- */
  console.log("\n-- payroll --");
  R('gm=today().slice(0,7);D.a[today()+"|1"]="P";D.a[today()+"|2"]="H"');
  ck("P counts as 1, H as 0.5", R("dmP()[1]") === 1 && R("dmP()[2]") === 0.5, R("JSON.stringify(dmP())"));
  ck("wage cost > 0", R("wagesP()") > 0, R("wagesP()"));
  ck("payroll rows compute net", R("payRows().every(r=>r.net===Math.round((r.earned-r.adv)*100)/100)"));
  /* the company filter must actually restrict payroll advances */
  R('co="0"'); const allAdv = R("R2(payRows().reduce((n,r)=>n+r.adv,0))");
  R('co="1"'); const c1Adv = R("R2(payRows().reduce((n,r)=>n+r.adv,0))");
  R('co="2"'); const c2Adv = R("R2(payRows().reduce((n,r)=>n+r.adv,0))");
  ck("company filter splits payroll advances", c1Adv > 0 && c2Adv > 0 && c1Adv + c2Adv === allAdv, c1Adv + "+" + c2Adv + " vs " + allAdv);
  R('co="0"');
  R('fy=fyOf(today());mn="All";co="0";br="0"');

  /* ---------- every screen renders ---------- */
  console.log("\n-- screens --");
  for (const t of ["dash", "work", "att", "adv", "fund", "pay", "sa", "ex", "inc", "bud", "mgr", "rep"]) {
    try {
      R(`tab='${t}';q='';lim=100;render()`);
      const html = els.get("screen").innerHTML || "";
      const dirty = />undefined</.test(html) || /NaN/.test(html) || /\[object Object\]/.test(html);
      ck("'" + t + "' renders", html.length > 120 && !dirty, dirty ? "undefined/NaN in output" : "len " + html.length);
    } catch (e) {
      ck("'" + t + "' renders", false, e.message);
    }
  }
  /* sub-views */
  R("tab='att';as='o';render()");
  ck("attendance: office grid", (els.get("screen").innerHTML || "").length > 200);
  R("tab='att';as='w';av='l';render()");
  ck("advances: list view", (els.get("screen").innerHTML || "").length > 150);
  R("tab='adv';av='s';onlyE=false;render()");
  ck("advances: sheet view", /<table/.test(els.get("screen").innerHTML || ""));
  R("tab='fund';fv='t';render()");
  ck("funds: transfers view", (els.get("screen").innerHTML || "").length > 150);
  R("tab='fund';fv='a';render()");
  ck("funds: advances view", (els.get("screen").innerHTML || "").length > 150);
  R("tab='fund';fv='d';render()");

  /* ---------- budgets ---------- */
  console.log("\n-- budgets --");
  R("D.bud={cat:{},mgr:{}}");
  R("setB(0,D.m.cat.indexOf('Miscellaneous'),25000)");
  ck("category budget stores", R('D.bud.cat["Miscellaneous"]') === 25000, R('JSON.stringify(D.bud.cat)'));
  R("setB(1,0,15000)");
  ck("manager budget stores 1-based", R('D.bud.mgr["1"]') === 15000, R('JSON.stringify(D.bud.mgr)'));
  ck("manager budgets are an object, not an array", !Array.isArray(R("D.bud.mgr")));
  /* an older server returned an array here — migrate() must normalise it */
  R("D.bud={cat:{},mgr:[null,7000,3000]};migrate()");
  ck("legacy array budgets normalise", R('D.bud.mgr["1"]') === 7000 && R('D.bud.mgr["2"]') === 3000 && !Array.isArray(R("D.bud.mgr")), R("JSON.stringify(D.bud.mgr)"));
  R("D.bud={cat:{},mgr:{}}");
  /* setB() commits, which bumps the stored version — resync so the
     persistence block below starts from the current base */
  R("VER=dbLoadLocal().ver");

  /* ---------- persistence ---------- */
  console.log("\n-- persistence --");
  const s1 = await R("save()");
  ck("save accepted", s1.ok === true, JSON.stringify(s1));
  ck("version bumped", R("dbLoadLocal().ver") > 0, R("dbLoadLocal().ver"));
  R("D.w.push({id:9999,n:'Persist Test',c:'1',wg:700,r:'Helper'})");
  await R("save()");
  ck("new worker survives reload", R("dbLoadLocal().data.w.some(w=>w.n==='Persist Test')"));
  const stale = await R("localApi('PUT','/data',{base:0,data:{}})");
  ck("stale write rejected with 409", stale._s === 409 && stale.conflict === true, JSON.stringify(stale).slice(0, 60));

  /* ---------- forms & navigation ---------- */
  console.log("\n-- forms --");
  // the fns live in the vm context, so call them there
  const opens = name => { try { R(name + "()"); return true; } catch (e) { return e.message; } };
  for (const [label, call] of [["worker", "addW"], ["advance", "addA"], ["expense", "addX"], ["income", "addI"], ["transfer", "addMP"], ["fund advance", "addFA"], ["settlement", "settleDlg"], ["bulk settle", "settleAllDlg"], ["bulk workers", "bulk"]]) {
    ck(label + " form opens", opens(call) === true, opens(call));
  }
  R('ME.role="super"');
  ck("settings opens for super admin", opens("settings") === true, opens("settings"));

  /* ---------- security-ish ---------- */
  console.log("\n-- escaping --");
  const q = R('jsq("a\'b")');
  ck("jsq escapes single quotes", q.indexOf("&#39;") > -1 && q.indexOf("\\&#39;") > -1, q);
  ck("esc escapes tags", R('esc("<img onerror=x>")').indexOf("&lt;") === 0);
  ck("wrong password rejected", (await R('localApi("POST","/auth/login",{id:"owner@jbb.com",password:"wrongpass"})'))._s === 401);
  ck("short password rejected", (await R('localApi("POST","/auth/login",{id:"x@y.com",password:"abc"})'))._s === 400);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL:", e); process.exit(1); });
