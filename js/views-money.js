"use strict";
/* ============================================================================
   JBB PANEL — views: Advances, Manager Funds, Payroll, Settlements,
   Expenses, Income, Budget
   ========================================================================== */

/* ---------------- Advances ---------------- */
function advTop() {
  const extra = `<button class="btn g" onclick="av=av==='s'?'l':'s';render()">${av === "s" ? "List view" : "Sheet view"}</button>` +
    (av === "s" ? `<button class="btn g" onclick="onlyE=!onlyE;render()">${onlyE ? "Show all workers" : "With entries only"}</button>
      <button class="btn g" onclick="expG()">Export</button>` : "");
  return sb("Search worker, amount, note", addB("addA()", "+ Entry") + extra);
}

function advList() {
  const W = {}; D.w.forEach(w => { W[w.id] = w.c; });
  const l = D.adv
    .filter(a => a.d && a.d.startsWith(gm) && (co === "0" || String(W[a.w]) === String(co)))
    .filter(a => qmatch(wname(a.w) + " " + a.amt + " " + (a.note || "")))
    .sort((x, y) => String(y.d).localeCompare(String(x.d)) || y.id - x.id);
  const given = R2(sum(l.filter(a => a.t === "g"), "amt"));
  const ret = R2(sum(l.filter(a => a.t === "r"), "amt"));
  const jama = R2(sum(l.filter(a => a.t === "n"), "amt"));
  return `<div class="grid">${kp("Given", rs(given), "neg")}${kp("Returned", rs(ret), "pos")}${kp("Jama / not counted", rs(jama))}${kp("Net", rs(given - ret))}</div>
  ${cut(l.map(a => `<div class="row" onclick="addA(${a.id})">
    <div>${esc(wname(a.w))}<small>${esc(a.d)} · ${a.t === "g" ? "Advance given" : a.t === "r" ? "Returned" : "Jama (not counted)"}${a.note ? " · " + esc(a.note) : ""}</small></div>
    <b class="r ${a.t === "g" ? "neg" : a.t === "r" ? "pos" : "mu"}">${a.t === "r" ? "−" : ""}${num(a.amt)}</b></div>`))}`;
}

/* sheet: workers as columns, day rows, per-worker running balance */
function advSheet() {
  const W = D.w.filter(w => (co === "0" || String(w.c) === String(co)) && qmatch(w.n));
  const GW = onlyE ? W.filter(w => D.adv.some(a => String(a.w) === String(w.id) && a.d && a.d.startsWith(gm))) : W;
  if (!GW.length) return empty;
  const nd = daysInMonth(gm), td = today();
  let h1 = "", h2 = "", h3 = "";
  for (const w of GW) {
    h1 += `<th colspan="2" class="sn" title="${esc(w.n)}">${esc(w.n)}</th>`;
    h2 += "<th>Amount</th><th>Remarks</th>";
    h3 += `<th colspan="2">${num(bal(w.id, monthEnd(gm)))}</th>`;
  }
  const byw = {};
  for (const a of D.adv) {
    if (!a.d || !a.d.startsWith(gm)) continue;
    const d = +a.d.slice(8, 10);
    (byw[a.w] = byw[a.w] || {})[d] = (byw[a.w] || {})[d] || [];
    byw[a.w][d].push(a);
  }
  let body = "";
  for (let d = 1; d <= nd; d++) {
    let row = `<th class="dc ${isSunday(gm, d) ? "sn" : ""} ${gm + "-" + pad2(d) === td ? "tn" : ""}" style="cursor:default">${d}<br><small>${weekday(gm, d)}</small></th>`;
    for (const w of GW) {
      const list = ((byw[w.id] || {})[d] || []);
      const amts = list.map(a => (a.t === "r" ? "−" : "") + num(a.amt)).join(" / ");
      const notes = uniq(list.map(a => String(a.note || "").trim()).filter(Boolean)).join(" · ");
      row += `<td style="cursor:pointer" onclick="addAOn(${w.id},${d})">${amts || "·"}</td><td style="cursor:pointer" onclick="addAOn(${w.id},${d})">${esc(notes)}</td>`;
    }
    body += `<tr>${row}</tr>`;
  }
  return `<div class="gw"><table><thead>
    <tr><th class="dc" rowspan="3">Day</th>${h1}</tr>
    <tr>${h2}</tr>
    <tr><th class="dc" style="top:auto">Balance end of month</th>${h3}</tr>
  </thead><tbody>${body}</tbody></table></div>
  <p class="mu mt">Cell dabane se us worker ka us din ka entry khulta hai. ₹ / worker ka closing balance upar hai.</p>`;
}

function advL() { return av === "s" ? advSheet() : advList(); }

/* expense & income exports as CSV in a copy box */
function csvDlg(title, heads, rows) {
  const csv = [heads, ...rows].map(r => r.map(v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join("\n");
  const d = dlg(`<b class="t">${esc(title)}</b><label>Copy karein — Excel / Google Sheets me paste karein</label>
    <textarea rows="10" readonly onfocus="this.select()">${esc(csv)}</textarea>
    <div class="acts"><button class="btn" onclick="closeDlg()">Close</button></div>`);
}
function expG() {
  const W = {}; D.w.forEach(w => { W[w.id] = w.c; });
  csvDlg("Export advances", ["Date", "Worker", "Manager", "Type", "Amount", "Note"],
    D.adv.filter(a => a.d && (co === "0" || String(W[a.w]) === String(co))).sort((a, b) => a.d.localeCompare(b.d))
      .map(a => [a.d, wname(a.w), cn(W[a.w]), a.t === "g" ? "Advance given" : a.t === "r" ? "Returned" : "Jama / not counted", a.amt, a.note || ""]));
}
function expX() {
  csvDlg("Export expenses", ["Voucher", "Date", "Manager", "Branch", "Department", "Category", "Sub", "Vendor", "Description", "Invoice", "Amount", "GST rate", "GST", "Total", "Mode", "Status", "Paid", "Outstanding", "Due", "Approval"],
    D.ex.filter(fxF).map(x => ["EXP-" + pad4(x.no), x.d, cn(x.c), x.br, x.dp, x.cat, x.sub || "", x.v, x.ds || "", x.inv || "", x.amt, Math.round((+x.g || 0) * 100) + "%", gs(x), tot(x), x.md, x.st, paid(x), outs(x), x.due || "", x.ap]));
}
function expI() {
  csvDlg("Export income", ["Receipt", "Date", "Manager", "Branch", "Source", "Party", "Mode", "Ref", "Amount", "GST rate", "GST", "Total", "Status"],
    D.inc.filter(fxF).map(x => ["INC-" + pad4(x.no), x.d, cn(x.c), x.br, x.src, x.party || "", x.md, x.ref || "", x.amt, Math.round((+x.g || 0) * 100) + "%", gs(x), tot(x), x.st]));
}

/* ---------------- Manager Funds ---------------- */
function fundTop() {
  const sw = `<div class="bar">${[["d", "Dashboard"], ["t", "Transfers"], ["a", "Advances"]] .map(([k, l]) =>
    `<button class="btn ${fv === k ? "" : "g"}" style="flex:1" onclick="fv='${k}';q='';lim=100;render()">${l}</button>`).join("")}</div>`;
  if (fv === "t") return sw + sb("Search remarks", addB("addMP()", "+ Send money") + `<button class="btn g" onclick="expF(1)">Export</button>`);
  if (fv === "a") return sw + sb("Search worker or remark", addB("addFA()", "+ Advance") + `<button class="btn g" onclick="expF(0)">Export</button>`);
  return sw;
}
function fsum(c) {
  const T = D.mp.filter(t => c === 0 || String(t.c) === String(c));      // transfers
  const A = D.fa.filter(a => c === 0 || String(a.c) === String(c));      // worker advances out of funds
  return { s: R2(sum(T, "amt")), a: R2(sum(A, "amt")), nt: T.length, na: A.length };
}
function fundL() {
  if (fv === "t") return fundT();
  if (fv === "a") return fundA();
  const T = fsum(0);
  const rows = D.cos.map((c, i) => {
    const f = fsum(i + 1);
    return `<tr onclick="fm(${i + 1})" style="cursor:pointer"><td>${esc(c.m)}</td><td>${esc(c.n || "")}</td><td>${num(f.s)}</td>
      <td>${num(f.a)}</td><td><b class="${cl(f.s - f.a)}">${num(f.s - f.a)}</b></td><td>${f.nt}</td><td>${f.na}</td></tr>`;
  });
  return `<h1>Manager Funds</h1>
  <div class="grid">${kp("Total sent", rs(T.s))}${kp("Worker advances", rs(T.a))}${kp("Balance left", rs(T.s - T.a), cl(T.s - T.a))}${kp("Transfers", T.nt)}</div>
  ${rows.length ? `<div class="tw"><table><thead><tr><th>Manager</th><th>Company</th><th>Total sent</th><th>Worker advances</th><th>Balance left</th><th>Transfers</th><th>Advance entries</th></tr></thead>
  <tbody>${rows.join("")}<tr><td colspan="2"><b>GRAND TOTAL</b></td><td><b>${num(T.s)}</b></td><td><b>${num(T.a)}</b></td>
  <td><b class="${cl(T.s - T.a)}">${num(T.s - T.a)}</b></td><td><b>${T.nt}</b></td><td><b>${T.na}</b></td></tr></tbody></table></div>` : empty}
  <p class="mu mt">Balance left = paisa bheja − workers ko diya. Laal matlab bheje se zyada de diya. Manager pe tap karke transfers dekhein.</p>`;
}
function fm(c) { co = String(c); fv = "t"; render(); }
function fundT() {
  const l = D.mp.filter(x => (co === "0" || String(x.c) === String(co)) && qmatch(x.rem || "")).sort((a, b) => String(b.d).localeCompare(String(a.d)) || b.id - a.id);
  const sent = R2(sum(l, "amt")), adv = R2(sum(l.map(trAdv)));
  return `<div class="grid">${kp("Sent", rs(sent))}${kp("Advances given", rs(adv))}${kp("Remaining", rs(sent - adv), cl(sent - adv))}</div>
  ${cut(l.map(x => { const u = trAdv(x); return `<div class="row" onclick="addMP(${x.id})">
    <div>${esc(cn(x.c))}<small>${esc((D.cos[x.c - 1] || {}).n || "")}</small><small>${esc(x.d)}${x.rem ? " · " + esc(x.rem) : ""}</small></div>
    <div style="text-align:right">Sent <b>${num(x.amt)}</b><small>Advances ${num(u)} · Left <b class="${cl(x.amt - u)}">${num(x.amt - u)}</b></small></div></div>`; }))}`;
}
function fundA() {
  const l = D.fa.filter(x => (co === "0" || String(x.c) === String(co)) && qmatch((x.w || "") + " " + (x.rem || ""))).sort((a, b) => String(b.d).localeCompare(String(a.d)) || b.id - a.id);
  const T = {}; D.mp.forEach(t => { T[t.id] = t; });
  return `<div class="grid">${kp("Total advances", rs(R2(sum(l, "amt"))), "neg")}${kp("Entries", l.length)}</div>
  ${cut(l.map(x => { const t = T[x.tr]; return `<div class="row" onclick="addFA(${x.id})">
    <div>${esc(x.w)}<small>${esc(cn(x.c))} · ${esc(x.d)}</small><small>${t ? "Transfer " + esc(t.d) + " · ₹" + num(t.amt) : "Transfer se linked nahi"}${x.rem ? " · " + esc(x.rem) : ""}</small></div>
    <b>${num(x.amt)}</b></div>`; }))}`;
}
function expF(isT) {
  const T = {}; D.mp.forEach(x => { T[x.id] = x; });
  if (isT) csvDlg("Export transfers", ["Date", "Company", "Manager", "Amount sent", "Total advance", "Remaining", "Remarks"],
    D.mp.filter(x => co === "0" || String(x.c) === String(co)).map(x => [x.d, (D.cos[x.c - 1] || {}).n, cn(x.c), x.amt, trAdv(x), x.amt - trAdv(x), x.rem || ""]));
  else csvDlg("Export worker advances", ["Advance date", "Company", "Manager", "Worker", "Amount", "Transfer date", "Remark"],
    D.fa.filter(x => co === "0" || String(x.c) === String(co)).map(x => [x.d, (D.cos[x.c - 1] || {}).n, cn(x.c), x.w, x.amt, (T[x.tr] || {}).d || "", x.rem || ""]));
}

/* ---------------- Payroll ---------------- */
function payTop() { return sb("Search workers", `<button class="btn g" onclick="payPdf()">PDF</button><button class="btn g" onclick="payCsv()">Export</button>`); }
function payRows() {
  const d = dmP(), A = {};
  const WC = {}; D.w.forEach(w => { WC[w.id] = w.c; });
  D.adv.forEach(a => {
    if (!inP(a.d)) return;
    if (co !== "0" && String(WC[a.w]) !== String(co)) return;
    A[a.w] = (A[a.w] || 0) + sg(a);
  });
  return D.w.filter(w => (co === "0" || String(w.c) === String(co)) && qmatch(w.n)).map(w => {
    const days = d[w.id] || 0, earned = R2(days * (+w.wg || 0)), adv = R2(A[w.id] || 0);
    return { w, days, earned, adv, net: R2(earned - adv), c: w.c };
  }).filter(r => r.days || r.adv);
}
function payL() {
  const rows = payRows();
  const E = R2(sum(rows, "earned")), N = R2(sum(rows, "adv"));
  return `<h1>Payroll</h1><p class="mu" style="margin:-8px 0 10px">${esc(gm)} · ${co === "0" ? "All managers" : esc(cn(co))}</p>
  <div class="grid">${kp("Earned", rs(E))}${kp("Advances", rs(N), "neg")}${kp("Net payable", rs(E - N), cl(E - N))}</div>
  ${!D.w.some(w => +w.wg) ? '<p class="mu neg">Sab workers ka wage 0 hai — Workers me wage daalein.</p>' : ""}
  ${cut(rows.map(r => `<div class="row" style="cursor:default">
    <div>${esc(r.w.n)}<small>${r.days} days × ${num(r.w.wg)} = ${num(r.earned)}${r.adv ? " · advance " + num(r.adv) : ""}</small></div>
    <b class="r ${r.net < 0 ? "neg" : ""}">${num(r.net)}</b></div>`))}
  <p class="mu mt">Days = present + half/2 si ${esc(gm)} ke hisaab se. Attendance bharne se apne aap badalta hai.</p>`;
}
function payCsv() {
  csvDlg("Payroll export", ["Worker", "Manager", "Days", "Daily wage", "Earned", "Advance", "Net payable"],
    payRows().map(r => [r.w.n, cn(r.c), r.days, r.w.wg, r.earned, r.adv, r.net]));
}

/* ---------------- Settlements (Smart Auto NIL) ---------------- */
function saTop() {
  return `<div class="bar"><button class="btn" onclick="settleDlg()">+ New settlement</button>
    <button class="btn g" onclick="settleAllDlg()">Bulk settle</button>
    <button class="btn g" onclick="saCsv()">Export</button></div>` +
    `<div class="bar"><input id="qbox" value="${esc(q)}" placeholder="Search worker" oninput="q=this.value.trim();upd()"></div>`;
}
function saL() {
  const hist = D.sh.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const nilKeys = Object.keys(D.nl || {});
  return `<h1>Settlements (Smart Auto NIL)</h1>
  <p class="mu" style="margin:-8px 0 10px">Period band karne pe worker ka balance settle hota hai aur carry aage badhta hai.</p>
  ${hist.length ? `<div class="tw"><table><thead><tr><th>Worker</th><th>Period</th><th>Status</th><th>Opening</th><th>Advance</th><th>Deducted</th><th>Carry</th><th>ID</th><th></th></tr></thead><tbody>
  ${hist.map(h => `<tr><td>${esc(h.workerName || wname(h.workerId))}</td><td>${esc((h.start || "") + " – " + (h.end || ""))}</td>
    <td>${pill(h.status, h.status === "VERIFIED" ? "ok" : "")}</td><td>${num(h.openingBalance)}</td><td>${num(h.totalAdvance)}</td>
    <td>${num(h.deductions)}</td><td><b class="${(+h.finalAmount || 0) >= 0 ? "pos" : "neg"}">${num(h.finalAmount)}</b></td><td>${esc(h.id)}</td>
    <td>${h.status === "VERIFIED" ? `<button class="btn g sm" onclick="undoS('${esc(h.id)}')">Undo</button>` : "—"}</td></tr>`).join("")}
  </tbody></table></div>` : '<div class="empty">Abhi koi settlement nahi. "New settlement" se shuru karein.</div>'}
  ${nilKeys.length ? hd("Active NIL records (" + nilKeys.length + ")") + `<div class="tw"><table><thead><tr><th>Worker</th><th>Period end</th><th>Net</th><th>Carry</th><th>From</th><th>At</th></tr></thead><tbody>
  ${nilKeys.map(k => { const [id, d] = String(k).split("|"); const r = D.nl[k] || {}; return `<tr><td>${esc(wname(+id))}</td><td>${esc(d)}</td><td>${num(r.net)}</td>
    <td><b>${num(r.carry)}</b></td><td>${esc(r.from || "")}</td><td>${esc(r.at || "")}</td></tr>`; }).join("")}
  </tbody></table></div>` : ""}`;
}
function settleDlg(presetW) {
  const workers = D.w.filter(w => (co === "0" || String(w.c) === String(co)) && qmatch(w.n));
  const d = dlg(`<b class="t">New settlement</b>
    <label>Worker</label><select id="s_w">${workers.map(w => `<option value="${w.id}" ${String(w.id) === String(presetW) ? "selected" : ""}>${esc(w.n)} — balance ${num(bal(w.id, monthEnd(gm)))}</option>`).join("")}</select>
    <label>Period from</label><input id="s_from" type="date" value="${esc(gm + "-01")}">
    <label>Period through</label><input id="s_to" type="date" value="${esc(monthEnd(gm))}">
    <label>Deductions (returned this period)</label><input id="s_ded" type="number" inputmode="decimal" value="0" placeholder="0">
    <label>Note</label><input id="s_note" placeholder="Optional">
    <div class="err" id="s_err"></div>
    <div class="acts"><button class="btn g" onclick="closeDlg()">Cancel</button><button class="btn" id="s_ok">Settle</button></div>
    <small>Settlement ke baad balance carry ho jata hai. Undo se wapas ho sakta hai.</small>`);
  const preview = () => {
    const w = $("#s_w").value, from = $("#s_from").value, to = $("#s_to").value;
    if (!from || !to) return;
    const p = workerPeriod(w, from, to);
    $("#s_ded").placeholder = num(p.returned);
    $("#s_err").classList.remove("on");
    $("#s_err").textContent = "";
  };
  $("#s_w").onchange = preview; $("#s_from").onchange = preview; $("#s_to").onchange = preview;
  preview();
  $("#s_ok").onclick = () => {
    const w = $("#s_w").value, from = $("#s_from").value, to = $("#s_to").value;
    const ded = +$("#s_ded").value || 0, note = $("#s_note").value.trim();
    if (!from || !to) return showFormErr("s_err", "Period dates chahiye");
    if (from > to) return showFormErr("s_err", "From date, To se pehle honi chahiye");
    const r = settleWorker(w, from, to, ded, note);
    if (r.err) return showFormErr("s_err", r.err);
    d.close();
    save().then(() => { toast("Settle ho gaya — carry " + rs(r.carry)); render(); });
  };
}
function settleAllDlg() {
  const list = D.w.filter(w => (co === "0" || String(w.c) === String(co)));
  const d = dlg(`<b class="t">Bulk settle — ${esc(gm)}</b>
    <p class="mu">Sab workers ka ${esc(gm + "-01")} se ${esc(monthEnd(gm))} tak balance settle hoga.</p>
    <label>Deductions — har worker ke returned amount use karein</label>
    <div style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="b_auto" checked style="width:auto"><span class="mu">Auto (period ke returns)</span></div>
    <label>Ya fixed deduction har worker ke liye</label><input id="b_ded" type="number" value="0">
    <div class="acts"><button class="btn g" onclick="closeDlg()">Cancel</button><button class="btn" id="b_ok">Settle ${list.length} workers</button></div>`);
  $("#b_ok").onclick = () => {
    const auto = $("#b_auto").checked, fixed = +$("#b_ded").value || 0;
    let n = 0;
    for (const w of list) {
      const from = gm + "-01", to = monthEnd(gm);
      const p = workerPeriod(w.id, from, to);
      if (!p.closing && !p.given) continue;
      const ded = auto ? p.returned : fixed;
      const r = settleWorker(w.id, from, to, ded, "Bulk " + gm);
      if (r.ok) n++;
    }
    d.close();
    save().then(() => { toast(n + " settlements bane"); render(); });
  };
}
function undoS(id) {
  ask("Ye settlement undo karein?", () => {
    const r = undoSettlement(id);
    if (r.err) return say(r.err);
    save().then(() => { toast("Settlement reversed"); render(); });
  });
}
function saCsv() {
  csvDlg("Settlements", ["ID", "Worker", "From", "To", "Opening", "Advance", "Deductions", "Carry", "Status"],
    D.sh.map(h => [h.id, h.workerName || wname(h.workerId), h.start, h.end, h.openingBalance, h.totalAdvance, h.deductions, h.finalAmount, h.status]));
}

/* ---------------- Expenses ---------------- */
function exTop() {
  return sb("Search vendor, bill, category", addB("addX()", "+ Expense") + `<button class="btn g" onclick="expX()">Export</button>`);
}
function exL() {
  const l = D.ex.filter(fx).filter(x => qmatch((x.v || "") + (x.ds || "") + (x.inv || "") + (x.cat || "") + "EXP-" + x.no))
    .sort((a, b) => String(b.d).localeCompare(String(a.d)) || b.no - a.no);
  return `<h1>Expenses</h1>
  <div class="grid">${kp("Net expense", rs(R2(sum(l, net))))}${kp("GST input", rs(R2(sum(l, gcr))))}${kp("Outstanding", rs(R2(sum(l, outs))), "neg")}${kp("Bills", l.length)}</div>
  ${cut(l.map(x => {
    const du = dues(x);
    return `<div class="row" onclick="addX(${x.id})">
      <div>${esc(x.v) || "–"}<small>EXP-${pad4(x.no)} · ${esc(x.cat)}${x.sub ? " / " + esc(x.sub) : ""}</small>
      <small>${esc(x.d)} · ${esc(cn(x.c))} · ${esc(x.br || "")}</small>
      <div>${pill(x.st, x.st === "Paid" ? "ok" : x.st === "Partial" ? "wn" : "bad")}${du === "OVERDUE" ? pill("OVERDUE", "bad") : ""}${x.ap !== "Approved" ? pill(x.ap, x.ap === "Rejected" ? "bad" : "wn") : ""}</div></div>
      <b class="r ${x.ap === "Rejected" ? "mu" : ""}">${num(tot(x))}</b></div>`;
  }))}`;
}

/* ---------------- Income ---------------- */
function incTop() {
  return sb("Search party, ref, source", addB("addI()", "+ Income") + `<button class="btn g" onclick="expI()">Export</button>`);
}
function incL() {
  const l = D.inc.filter(fx).filter(x => qmatch((x.party || "") + (x.ref || "") + (x.src || "") + "INC-" + x.no))
    .sort((a, b) => String(b.d).localeCompare(String(a.d)) || b.no - a.no);
  return `<h1>Income</h1>
  <div class="grid">${kp("Net income", rs(R2(sum(l, "amt"))))}${kp("GST collected", rs(R2(sum(l, x => gs(x)))))}${kp("Receivable", rs(R2(sum(l, rin))), "neg")}${kp("Entries", l.length)}</div>
  ${cut(l.map(x => `<div class="row" onclick="addI(${x.id})">
    <div>${esc(x.party) || esc(x.src)}<small>INC-${pad4(x.no)} · ${esc(x.src)} · ${esc(x.md)}</small>
    <small>${esc(x.d)} · ${esc(cn(x.c))} · ${esc(x.br || "")}</small><div>${pill(x.st, x.st === "Received" ? "ok" : "bad")}</div></div>
    <b class="r">${num(tot(x))}</b></div>`))}`;
}

/* ---------------- Budget ---------------- */
function budL() {
  const X = D.ex.filter(x => inF(x.d) && x.ap !== "Rejected");
  const one = (n, b, a, k, i) => {
    const s = bst(b, a);
    return `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(n)}</b>${pill(s, bstPill(s))}</div>
      <div style="display:flex;gap:8px;align-items:center;margin:8px 0"><span class="mu" style="white-space:nowrap">Annual ₹</span>
      <input type="number" inputmode="decimal" value="${b || ""}" onchange="setB(${k},${i},this.value)"></div>
      ${bar(a, b, a > b && b ? "var(--red)" : "")}
      <small>Monthly ${num(b / 12)} · Actual ${num(a)} · ${b ? Math.round(a / b * 100) + "% used · Left " + num(b - a) : "set a budget"}</small></div>`;
  };
  return `<h1>Budget</h1><p class="mu" style="margin:-8px 0 10px">${esc(fy)}</p>
  <div class="grid">${kp("Budget set", Object.values(D.bud.cat).filter(Boolean).length + Object.values(D.bud.mgr).filter(Boolean).length)}${kp("Actual expense", rs(R2(sum(X, net))))}</div>
  ${hd("Category budget — " + fy)}${D.m.cat.map((c, i) => one(c, +D.bud.cat[c] || 0, R2(sum(X.filter(x => x.cat === c), net)), 0, i)).join("")}
  ${D.cos.length ? hd("Manager budget — " + fy) + D.cos.map((c, i) => one(c.m, +D.bud.mgr[i + 1] || 0, R2(sum(X.filter(x => String(x.c) === String(i + 1)), net)), 1, i)).join("") : ""}`;
}
function setB(k, i, v) {
  if (k) D.bud.mgr[String(i + 1)] = +v || 0; else D.bud.cat[D.m.cat[i]] = +v || 0;
  commit(); upd();
}

/* share the error helper */
function showFormErr(id, msg) {
  const e = document.getElementById(id);
  if (!e) return;
  e.textContent = msg;
  e.classList.add("on");
}
