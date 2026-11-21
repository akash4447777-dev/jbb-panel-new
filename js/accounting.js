"use strict";
/* ============================================================================
   JBB PANEL — accounting engine
   Pure functions: worker ledger balances, settlements (NIL), settlements history,
   bill ageing, GST summary, budget status.
   Money is rounded to paise, never float-accumulated.
   ========================================================================== */

const R2 = v => Math.round((+v || 0) * 100) / 100;
const validDate = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);

/* ---------------- worker ledger ----------------
   Events per worker, ordered by date then type:
     advance  g=+amt (given), r=-amt (returned), n=0 (jama / not counted)
     nill     o=1  -> balance is reset to the carry value
   This mirrors the server-side accounting core exactly. */
function workerEvents(workerId) {
  const ev = [];
  for (const a of D.adv) {
    if (String(a.w) !== String(workerId)) continue;
    if (!validDate(a.d)) continue;
    if (a.t === "n") continue;                                 // jama: displayed but never counted
    ev.push({ o: 0, d: a.d, v: (a.t === "r" ? -1 : 1) * R2(a.amt), id: a.id, kind: a.t });
  }
  for (const k in D.nl) {
    const [id, raw] = String(k).split("|");
    if (String(id) !== String(workerId)) continue;
    const d = raw && raw.length === 7 ? monthEnd(raw) : raw;
    if (!validDate(d)) continue;
    ev.push({ o: 1, d, c: R2(D.nl[k].carry || 0), k, kind: "s" });
  }
  ev.sort((a, b) => a.d.localeCompare(b.d) || (a.o || 0) - (b.o || 0) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  let balance = 0;
  for (const e of ev) {
    const before = balance;
    balance = e.o ? e.c : R2(balance + e.v);
    e.balance = balance;
    e.settled = e.o ? R2(Math.max(0, before - e.c)) : 0;
  }
  return ev;
}

/* balance as of a date (inclusive) */
function bal(workerId, to) {
  const ev = workerEvents(workerId);
  let b = 0;
  for (const e of ev) { if (e.d <= to) b = e.balance; else break; }
  return b;
}

/* summary for a date range */
function workerPeriod(workerId, from, to) {
  const rows = D.adv.filter(a => String(a.w) === String(workerId) && a.d >= from && a.d <= to);
  const ev = workerEvents(workerId).filter(e => e.o && e.d >= from && e.d <= to);
  const att = [];
  for (let d = +from.slice(8, 10); d <= +to.slice(8, 10); d++) {
    const k = from.slice(0, 8) + pad2(d) + "|" + workerId;
    if (D.a[k]) att.push(D.a[k]);
  }
  return {
    opening: bal(workerId, addDay(from, -1)),
    closing: bal(workerId, to),
    given: sum(rows.filter(a => a.t === "g"), "amt"),
    returned: sum(rows.filter(a => a.t === "r"), "amt"),
    notCounted: sum(rows.filter(a => a.t === "n"), "amt"),
    settled: sum(ev, e => e.settled),
    present: att.filter(s => s === "P").length,
    half: att.filter(s => s === "H").length,
    absent: att.filter(s => s === "A").length,
    worked: att.reduce((n, s) => n + (s === "P" ? 1 : s === "H" ? 0.5 : 0), 0)
  };
}

/* all workers on the current filter, sorted by name */
const filterWorkers = () => D.w.filter(w => (co === "0" || String(w.c) === String(co)) && qmatch(w.n + " " + w.r + " " + cn(w.c)));

/* ---------------- settlement (Smart Auto NIL) ----------------
   Closing a period for a worker:
     net        = closing balance for the period
     deductions = what the worker returned during the period + explicit adjustments
     carry      = what is still owed after settlement (usually 0)
   The result is written to D.nl[workerId|periodEnd] and a history row to D.sh. */
function settleWorker(workerId, from, to, deductions, note) {
  const w = D.w.find(x => String(x.id) === String(workerId));
  if (!w) return { err: "Worker nahi mila" };
  const p = workerPeriod(workerId, from, to);
  const ded = R2(deductions || 0);
  const net = R2(p.closing);
  /* carry = whatever is deliberately left outstanding (0 = fully settled).
     Defaulting carry to the full balance would silently keep the worker in debt. */
  const carry = R2(Math.max(0, net - ded));
  const id = "ST-" + pad4(takeId());
  const key = workerId + "|" + to;
  D.nl[key] = {
    net, carry, deductions: ded,
    from, at: today(),
    smartSettlementId: id,
    note: note || ""
  };
  D.sh.push({
    id, workerId: String(workerId), workerName: w.n,
    start: from, end: to,
    openingBalance: p.opening, totalAdvance: p.given,
    deductions: ded, finalAmount: carry,
    status: "VERIFIED", createdAt: nowIso(),
    priorNil: null, priorEntryStatus: []
  });
  return { ok: true, id, net, carry, deductions: ded };
}

/* undo the most recent settlement for a worker (append-only: mark REVERSED) */
function undoSettlement(id) {
  const h = D.sh.find(x => String(x.id) === String(id));
  if (!h) return { err: "Settlement nahi mila" };
  if (h.status !== "VERIFIED") return { err: "Ye settlement already reversed hai" };
  const later = D.sh.some(x => String(x.workerId) === String(h.workerId) && x.status === "VERIFIED" && x.end > h.end);
  if (later) return { err: "Pehle is worker ke baad wale settlement undo karein" };
  const key = h.workerId + "|" + h.end;
  if (D.nl[key] && D.nl[key].smartSettlementId && D.nl[key].smartSettlementId !== h.id) {
    return { err: "Active NIL record is settlement se match nahi karta" };
  }
  delete D.nl[key];
  h.status = "REVERSED";
  h.reversedAt = nowIso();
  return { ok: true };
}

/* ---------------- bill ageing ---------------- */
function ageing(asOf) {
  asOf = asOf || today();
  const b = [];
  for (const [kind, col] of [["exp", "ex"], ["inc", "inc"]]) {
    for (const x of D[col]) {
      if (!inScope(x)) continue;
      const gross = tot(x), pd = paid(x), out = outs(x);
      const due = x.due || "";
      let late = null;
      if (due && validDate(due)) late = Math.floor((Date.parse(asOf + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 864e5);
      b.push({ kind, id: x.id, no: x.no, d: x.d, party: kind === "exp" ? x.v : x.party, c: x.c, br: x.br, gross, paid: pd, out, due, late, overdue: out > 0 && late !== null && late > 0, status: x.st, approval: x.ap || "Approved" });
    }
  }
  return b;
}

function ageingBuckets(rows) {
  const z = { age0: 0, age30: 0, age60: 0, age90: 0, over90: 0, missingDue: 0, overdue: 0, dueSoon: 0 };
  const t = today();
  for (const r of rows) {
    if (r.out <= 0) continue;
    if (!r.due) { z.missingDue += r.out; continue; }
    const late = Math.floor((Date.parse(t + "T00:00:00Z") - Date.parse(r.due + "T00:00:00Z")) / 864e5);
    if (late > 0) z.overdue += r.out;
    else if (late >= -7) z.dueSoon += r.out;
    if (late <= 0) z.age0 += r.out;
    else if (late <= 30) z.age30 += r.out;
    else if (late <= 60) z.age60 += r.out;
    else if (late <= 90) z.age90 += r.out;
    else z.over90 += r.out;
  }
  return z;
}

/* ---------------- GST summary by rate ---------------- */
function gstSummary(from, to) {
  const X = D.ex.filter(fx), I = D.inc.filter(i => inScope(i) && i.d >= from && i.d <= to);
  const rates = uniq([...X.map(x => +x.g || 0), ...I.map(x => +x.g || 0)]).sort((a, b) => a - b);
  const rows = rates.map(g => {
    const ci = sum(X.filter(x => (+x.g || 0) === g), gcr);
    const co_ = sum(I.filter(x => (+x.g || 0) === g), x => gs(x));
    return { rate: g, input: R2(ci), output: R2(co_), net: R2(co_ - ci) };
  });
  const ti = R2(sum(rows, "input")), tout = R2(sum(rows, "output"));
  return { rows, totalInput: ti, totalOutput: tout, totalNet: R2(tout - ti), taxableExpense: R2(sum(X, net)), taxableIncome: R2(sum(I, "amt")) };
}

/* ---------------- budget status ---------------- */
const bst = (b, a) => !b ? "No budget set" : a > b ? "OVER BUDGET" : a >= 0.9 * b ? "Near limit" : "On track";
const bstPill = s => s === "OVER BUDGET" ? "bad" : s === "Near limit" ? "wn" : s === "On track" ? "ok" : "";

/* ---------------- period filter helpers used by views ---------------- */
const fx = x => inScope(x) && inP(x.d);                    // current period, scoped
const fxF = x => inScope(x) && inF(x.d);                   // current FY, scoped

/* expenses visible in money terms (rejected excluded) */
function expensesIn(from, to) { return D.ex.filter(x => inScope(x) && x.d >= from && x.d <= to && x.ap !== "Rejected"); }
function incomeIn(from, to) { return D.inc.filter(x => inScope(x) && x.d >= from && x.d <= to); }

/* dashboard numbers */
function dashboard() {
  const X = D.ex.filter(fx), I = D.inc.filter(fx);
  const inc = R2(sum(I, "amt")), exp = R2(sum(X, net));
  const wageCost = D.opt.pw ? R2(wagesP()) : 0;
  const profit = R2(inc - exp - wageCost);
  const W = {}; D.w.forEach(w => { W[w.id] = w.c; });
  const adv = R2(sum(D.adv.filter(a => (co === "0" || String(W[a.w]) === String(co)) && inP(a.d)), sg));
  const present = D.w.filter(w => (co === "0" || String(w.c) === String(co)) && D.a[today() + "|" + w.id] === "P").length;
  const total = D.w.filter(w => co === "0" || String(w.c) === String(co)).length;
  const bad = D.ex.filter(x => inScope(x) && inP(x.d) && ["d", "c", "br", "dp", "cat", "v", "amt", "md", "st", "ap"].some(k => x[k] === "" || x[k] == null)).length
    + D.inc.filter(x => inScope(x) && inP(x.d) && ["d", "c", "br", "src", "md", "amt", "st"].some(k => x[k] === "" || x[k] == null)).length;
  const outX = R2(sum(D.ex.filter(fxF).map(outs)));
  const recI = R2(sum(D.inc.filter(x => inScope(x) && inF(x.d)).map(rin)));
  return { inc, exp, wageCost, profit, adv, present, total, bad, outX, recI, expCount: X.length, incCount: I.length };
}
