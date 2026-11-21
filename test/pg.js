"use strict";
/**
 * Postgres storage-layer test — no real database required.
 *
 * Loads server.js with a stubbed `pg` module injected into require.cache, then
 * verifies the SQL shape and round-trip behaviour of the postgres backend:
 * table creation, seeding, loading, ON CONFLICT upsert, and fallback to file
 * storage when `pg` is missing.
 *
 * Usage: node test/pg.js
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const Module = require("module");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " -> " + extra : "")); }
}

/* ---------- stub `pg` ---------- */
const calls = [];
let rows = [];           // simulated table contents
let failNext = false;

class FakePool {
  constructor(cfg) { this.cfg = cfg; calls.push(["Pool", cfg]); }
  async query(sql, params) {
    const s = String(sql).replace(/\s+/g, " ").trim();
    calls.push(["query", s, params]);
    if (failNext) { failNext = false; throw new Error("connection refused"); }
    if (/^CREATE TABLE/i.test(s)) return { rows: [] };
    if (/^SELECT doc/i.test(s)) return { rows: rows.slice() };
    if (/^INSERT INTO/i.test(s)) {
      const doc = params && params[0];
      if (!rows.length) rows.push({ doc: JSON.parse(doc) });
      else rows[0].doc = JSON.parse(doc);
      return { rows: [] };
    }
    return { rows: [] };
  }
}
const fakePg = { Pool: FakePool };

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  if (req === "pg") return "pg-stub";
  return origResolve.call(this, req, parent, ...rest);
};
require.cache["pg-stub"] = { id: "pg-stub", filename: "pg-stub", loaded: true, exports: fakePg };

/* ---------- per-run data dir ---------- */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jbb-pg-"));
process.env.DATA_DIR = tmpDir;
process.env.STORE_MODE = "postgres";
process.env.DATABASE_URL = "postgres://user:pass@db.example.com:5432/jbb";
process.env.PORT = "0";

const ROOT = path.join(__dirname, "..");
delete require.cache[require.resolve(path.join(ROOT, "server.js"))];
const server = require(path.join(ROOT, "server.js"));

(async () => {
  console.log("Postgres storage layer");

  // boot() is async for postgres; trigger it directly
  server.boot();
  await new Promise((r) => setTimeout(r, 400));

  const sqls = calls.filter((c) => c[0] === "query").map((c) => c[1]);

  check("constructed a Pool with the connection string",
    calls.some((c) => c[0] === "Pool" && c[1].connectionString === process.env.DATABASE_URL));

  check("created the store table if missing",
    sqls.some((s) => /CREATE TABLE IF NOT EXISTS jbb_store/i.test(s)),
    sqls[0]);

  check("table enforces a single row",
    sqls.some((s) => /CHECK \(id = 1\)/i.test(s)));

  check("selected the document",
    sqls.some((s) => /^SELECT doc FROM jbb_store WHERE id = 1$/i.test(s)));

  check("seeded the empty table",
    sqls.some((s) => /^INSERT INTO jbb_store/i.test(s)));
  check("seed contains workers", rows.length === 1 && Array.isArray(rows[0].doc.data.w) && rows[0].doc.data.w.length > 0);

  // a write must use ON CONFLICT upsert so the row is replaced atomically
  const before = calls.length;
  const st = server.getStore();
  st.data.w.push({ id: 999, n: "Pg Worker", c: "1", wg: 800 });
  st.ver += 1;
  server.__persist ? server.__persist() : null;

  // exercise persist through the HTTP surface instead
  const base = "http://127.0.0.1:" + (server.server.address() ? server.server.address().port : 0);
  const login = await (await fetch(base + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "pg@test.com", password: "pgtest1" })
  })).json();
  check("login works on postgres mode", !!login.token, JSON.stringify(login).slice(0, 120));

  const put = await fetch(base + "/data", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + login.token },
    body: JSON.stringify({ base: login.token ? undefined : 0, data: { w: [{ id: 1, n: "X" }], cos: [], bud: {} } })
  });
  const putJson = await put.json();
  check("PUT /data accepted", put.ok === true, JSON.stringify(putJson).slice(0, 120));

  await new Promise((r) => setTimeout(r, 300));
  const upserts = calls.slice(before).filter((c) => c[0] === "query" && /ON CONFLICT \(id\) DO UPDATE/i.test(c[1]));
  check("write used ON CONFLICT upsert", upserts.length > 0);
  check("upsert persisted the document to the table",
    rows.length === 1 && Array.isArray(rows[0].doc.data.w) && rows[0].doc.data.w.length === 1);

  // graceful degradation: pg missing -> file fallback
  delete require.cache["pg-stub"];
  Module._resolveFilename = function (req, parent, ...rest) {
    if (req === "pg") { const e = new Error("Cannot find module 'pg'"); e.code = "MODULE_NOT_FOUND"; throw e; }
    return origResolve.call(this, req, parent, ...rest);
  };
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "jbb-fb-"));
  process.env.DATA_DIR = cfg;
  process.env.PORT = "0";
  delete require.cache[require.resolve(path.join(ROOT, "server.js"))];
  const srv2 = require(path.join(ROOT, "server.js"));
  srv2.boot();
  await new Promise((r) => setTimeout(r, 400));
  check("falls back to file storage when pg is missing",
    fs.existsSync(path.join(cfg, "store.json")),
    "store.json not created in " + cfg);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
