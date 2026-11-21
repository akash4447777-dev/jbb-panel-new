"use strict";
/* ============================================================================
   JBB PANEL — views: Dashboard, Workers, Attendance, Managers/Settings
   ========================================================================== */

/* ---------------- Dashboard ---------------- */
function dashL() {
  const d = dashboard();
  const X = D.ex.filter(fx);
  const catRows = (D.m.cat || []).map(c => [c, R2(sum(X.filter(x => x.cat === c), net))]).filter(r => r[1]).sort((a, b) => b[1] - a[1]);
  const mdRows = (D.m.md || []).map(c => [c, R2(sum(X.filter(x => x.md === c), net))]).filter(r => r[1]).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...catRows.map(r => r[1]));
  const mgrRows = D.cos.map((c, i) => {
    const f = x => String(x.c) === String(i + 1) && inF(x.d);
    const a = R2(sum(D.inc.filter(f), "amt")), b = R2(sum(D.ex.filter(f), net));
    return [esc(c.m), num(a), num(b), `<b class="${cl(a - b)}">${num(a - b)}</b>`];
  });
  const recent = D.adv.slice().sort((a, b) => String(b.d).localeCompare(String(a.d))).slice(0, 8);

  return `<h1>Dashboard</h1>
  <p class="mu" style="margin:-8px 0 12px">${esc(fy)} · ${mn === "All" ? "All months" : esc(mn)} · ${co === "0" ? "All managers" : esc(cn(co))}</p>
  <div class="grid">
    ${kp("Income", rs(d.inc))}
    ${kp("Expense", rs(d.exp))}
    ${d.wageCost ? kp("Wage cost", rs(d.wageCost)) : ""}
    ${kp("Profit", rs(d.profit), cl(d.profit))}
    ${kp("Receivable", rs(d.recI), d.recI ? "neg" : "")}
    ${kp("Outstanding bills", rs(d.outX), d.outX ? "neg" : "")}
    ${kp("Worker advances", rs(d.adv), d.adv ? "neg" : "")}
    ${kp("Present today", d.present + "/" + d.total)}
    ${d.bad ? kp("Incomplete records", d.bad, "neg") : ""}
  </div>
  ${catRows.length ? hd("Expense by category") + `<div class="card">${catRows.map(([n, v]) =>
    `<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><span>${esc(n)}</span><b>${num(v)}</b></div>${bar(v, maxCat)}</div>`).join("")}</div>` : ""}
  ${mdRows.length ? hd("Expense by payment mode") + tbl(["Mode", "Amount"], mdRows.map(([n, v]) => [esc(n), num(v)])) : ""}
  ${mgrRows.length ? hd("Manager profit — " + fy) + tbl(["Manager", "Income", "Expense", "Profit"], mgrRows) : ""}
  ${recent.length ? hd("Recent advances") + recent.map(a =>
    `<div class="row" onclick="addA(${a.id})"><div>${esc(wname(a.w))}<small>${esc(a.d)} · ${a.t === "g" ? "Advance" : a.t === "r" ? "Returned" : "Not counted"}${a.note ? " · " + esc(a.note) : ""}</small></div>
     <b class="r ${a.t === "g" ? "neg" : a.t === "r" ? "pos" : "mu"}">${a.t === "r" ? "−" : ""}${num(a.amt)}</b></div>`).join("") : ""}`;
}

/* ---------------- Workers ---------------- */
function wname(id) { const w = D.w.find(x => String(x.id) === String(id)); return w ? w.n : "(deleted)"; }
function workL() {
  const list = filterWorkers();
  const rows = list.map(w => {
    const b = bal(w.id, "9999-12-31");
    return `<div class="row" onclick="addW(${w.id})">
      <div>${esc(w.n)}<small>${esc(cn(w.c))} · ${esc(w.r || "—")} · wage ${num(w.wg)}</small></div>
      ${b ? `<span class="mu r">Advance<br><b class="${b > 0 ? "neg" : "pos"}">${num(b)}</b></span>` : ""}</div>`;
  });
  const totalAdv = R2(sum(list.map(w => bal(w.id, "9999-12-31"))));
  return `<h1>Workers</h1>
  <div class="grid">${kp("Workers", list.length)}${kp("Total advance", rs(totalAdv), totalAdv ? "neg" : "")}${kp("No wage set", list.filter(w => !(+w.wg)).length, list.filter(w => !(+w.wg)).length ? "wn" : "")}</div>
  ${cut(rows)}`;
}

/* ---------------- Attendance ---------------- */
function attTop() {
  const sw = `<div class="bar">${[["w", "Workers"], ["o", "Office"], ["m", "Managers"]].map(([k, l]) =>
    `<button class="btn ${as === k ? "" : "g"}" style="flex:1" onclick="as='${k}';q='';lim=100;render()">${l}</button>`).join("")}</div>`;
  const un = undoStack.length ? `<button class="btn g" onclick="undoA()">↶ Undo last</button>` : "";
  if (as === "w") return sw + `<div class="bar">
    <button class="btn g" onclick="allP()">All present</button>
    <button class="btn g" onclick="clrA()">Clear all</button>
    <button class="btn g" onclick="bulkTime()">Set time (all)</button>
    <button class="btn g" onclick="attPdfAll('w')">PDF</button>
    <button class="btn g" onclick="attExcelAll('w')">Excel</button>${un}</div>` +
    `<div class="bar"><input id="qbox" value="${esc(q)}" placeholder="Search workers" oninput="q=this.value.trim();upd()"></div>`;
  return sw + `<div class="bar"><button class="btn" onclick="addS()">+ Add name</button>
    <button class="btn g" onclick="attPdfAll('${as}')">PDF</button>
    <button class="btn g" onclick="attExcelAll('${as}')">Excel</button>${un}</div>`;
}

function attL() {
  const list = D.w.filter(w => (co === "0" || String(w.c) === String(co)) && qmatch(w.n));
  let p = 0, h = 0, a = 0;
  const rows = list.map(w => {
    const v = D.a[date + "|" + w.id] || "";
    v === "P" ? p++ : v === "H" ? h++ : v === "A" && a++;
    const t = D.t[date + "|" + w.id] || {};
    return `<div class="row" style="cursor:default">
      <div>${esc(w.n)}<small>${esc(cn(w.c))}</small>
        <button class="btn g sm" onclick="event.stopPropagation();timeDlg(${w.id},'${date}')">◷ ${t.i || t.o ? fmtT(t.i) + "–" + fmtT(t.o) : "time"}</button></div>
      <div class="seg">${["P", "H", "A"].map(k => `<button class="${v === k ? "on " + k : ""}" onclick="mark(${w.id},'${k}')">${k}</button>`).join("")}</div></div>`;
  });
  return `<div class="card" style="margin-bottom:10px">${esc(date)} · Present ${p} · Half ${h} · Absent ${a} · Unmarked ${list.length - p - h - a}<br>
    <small>P = present, H = half day, A = absent. ◷ se in/out time.</small></div>${cut(rows)}`;
}

/* monthly grid for office staff / managers */
function staffL() {
  const list = D.s.filter(s => s.g === as && qmatch(s.n));
  const nd = daysInMonth(gm);
  let head = "";
  for (let d = 1; d <= nd; d++) head += `<th class="${isSunday(gm, d) ? "sn" : ""} ${gm + "-" + pad2(d) === today() ? "tn" : ""}">${d}<br><small>${weekday(gm, d)}</small></th>`;
  const rows = list.map(s => {
    let p = 0, hf = 0, a = 0, hm = 0, cells = "";
    for (let d = 1; d <= nd; d++) {
      const dt = gm + "-" + pad2(d), v = D.a[dt + "|" + s.id] || "", t = D.t[dt + "|" + s.id] || {};
      v === "P" ? p++ : v === "H" ? hf++ : v === "A" && a++;
      hm += mins(t.i, t.o);
      cells += `<td class="${v}" onclick="sc(event,${s.id},'${dt}')"><span style="display:block;font-weight:700">${v || "·"}</span>
        <button type="button" style="border:0;background:transparent;color:var(--muted);font-size:9px;padding:0;cursor:pointer" onclick="event.stopPropagation();timeDlg(${s.id},'${dt}')">◷</button></td>`;
    }
    return `<tr><th class="dc" style="cursor:default">${esc(s.n)}<button class="btn g sm" style="margin-top:3px" onclick="addS(${s.id})">edit</button></th>${cells}
      <td><b>${p}</b></td><td>${hf}</td><td>${a}</td><td><b>${p + hf / 2}</b></td><td>${(hm / 60).toFixed(1)}</td></tr>`;
  });
  if (!list.length) return empty;
  return `<div class="card" style="margin-bottom:10px;font-size:13px"><b>${esc(gm)}</b> · ${as === "o" ? "Office staff" : "Managers"} · ${list.length} people<br>
    <small>Cell dabayein: P → H → A → blank. ◷ se time.</small></div>
    <div class="gw"><table><thead><tr><th class="dc">Name</th>${head}<th>P</th><th>H</th><th>A</th><th>Days</th><th>Hrs</th></tr></thead>
    <tbody>${rows.join("")}</tbody></table></div>`;
}

/* attendance mutations (with undo) */
function mark(wid, v) {
  const k = date + "|" + wid;
  pushUndo([k]);
  if (D.a[k] === v) delete D.a[k]; else D.a[k] = v;
  commit(); upd();
}
function sc(e, sid, dt) {
  const k = dt + "|" + sid;
  pushUndo([k]);
  const cur = D.a[k] || "";
  const nx = { "": "P", P: "H", H: "A", A: "" }[cur];
  nx ? D.a[k] = nx : delete D.a[k];
  commit(); keepScroll();
}
function pushUndo(keys, times) {
  undoStack.push({ keys, times: times || null });
  if (undoStack.length > 30) undoStack.shift();
}
function undoA() {
  const u = undoStack.pop();
  if (!u) return;
  for (const k of u.keys) delete D.a[k];
  if (u.times) for (const k of u.times) delete D.t[k];
  commit("Undo ho gaya");
  render();
}
function setMany(keys, v, t) {
  pushUndo(keys, t ? keys : null);
  for (const k of keys) {
    if (v) D.a[k] = v; else delete D.a[k];
    if (t) D.t[k] = { i: t.i, o: t.o }; else if (t === 0) delete D.t[k];
  }
  commit();
}
function allP() {
  const keys = D.w.filter(w => co === "0" || String(w.c) === String(co)).map(w => date + "|" + w.id);
  setMany(keys, "P"); render(); toast("Sab present mark ho gaye");
}
function clrA() {
  ask("Aaj ki saari attendance clear karein?", () => {
    const keys = D.w.filter(w => co === "0" || String(w.c) === String(co)).map(w => date + "|" + w.id);
    setMany(keys, ""); render(); toast("Clear ho gaya");
  });
}
function bulkTime() {
  const keys = D.w.filter(w => co === "0" || String(w.c) === String(co)).map(w => date + "|" + w.id);
  const d = dlg(`<b class="t">Set time for everyone</b><p class="mu">${esc(date)} — sabhi workers ke liye</p>
    <label>In time</label><input id="bi" type="time" value="09:00">
    <label>Out time</label><input id="bo" type="time" value="18:00">
    <div class="acts"><button class="btn g" onclick="closeDlg()">Cancel</button><button class="btn" id="bs2">Apply</button></div>
    <small>Undo last se wapas ho sakta hai.</small>`);
  $("#bs2").onclick = () => { setMany(keys, "P", { i: $("#bi").value, o: $("#bo").value }); d.close(); render(); toast("Time set ho gaya"); };
}
function timeDlg(wid, dt) {
  const k = dt + "|" + wid, t = D.t[k] || {};
  const d = dlg(`<b class="t">In / Out time</b><p class="mu">${esc(dt)}</p>
    <label>In</label><input id="ti" type="time" value="${esc(t.i || "")}">
    <label>Out</label><input id="to" type="time" value="${esc(t.o || "")}">
    <div class="acts"><button class="btn g" onclick="closeDlg()">Cancel</button>
    <button class="btn g" id="tclr">Clear</button><button class="btn" id="tsave">Save</button></div>`);
  $("#tsave").onclick = () => {
    const i = $("#ti").value, o = $("#to").value;
    if (!i && !o) delete D.t[k]; else D.t[k] = { i, o };
    d.close(); commit(); render();
  };
  $("#tclr").onclick = () => { delete D.t[k]; d.close(); commit(); render(); };
}
function dayDlg(dnum) {
  const list = D.s.filter(s => s.g === as);
  const keys = list.map(s => gm + "-" + pad2(dnum) + "|" + s.id);
  const d = dlg(`<b class="t">${esc(gm + "-" + pad2(dnum))}</b><p class="mu">${as === "o" ? "Office" : "Managers"} · ${list.length} people</p>
    <label>Time (optional)</label><div style="display:flex;gap:6px"><input id="di" type="time"><input id="do" type="time"></div>
    <div class="acts" style="flex-wrap:wrap"><button class="btn" id="d1">All present</button>
      <button class="btn g" id="d2">All absent</button><button class="btn g" id="d3">Clear</button>
      <button class="btn g" onclick="closeDlg()">Cancel</button></div>`);
  const ap = (v, withT) => () => {
    setMany(keys, v, withT ? { i: $("#di").value, o: $("#do").value } : 0);
    d.close(); render();
  };
  $("#d1").onclick = ap("P", true);
  $("#d2").onclick = ap("A");
  $("#d3").onclick = ap("");
}

/* ---------------- Managers / companies ---------------- */
function mgrL() {
  const rows = D.cos.map((c, i) => {
    const f = x => String(x.c) === String(i + 1) && inF(x.d);
    const X = D.ex.filter(f), inc = R2(sum(D.inc.filter(f), "amt")), exp = R2(sum(X, net));
    const bg = +D.bud.mgr[i + 1] || 0;
    return [esc(c.m) + (c.x ? ' <span class="pill">hidden</span>' : ""), esc(c.n || ""), num(inc), num(exp),
      `<b class="${cl(inc - exp)}">${num(inc - exp)}</b>`, inc ? Math.round((inc - exp) / inc * 100) + "%" : "–",
      num(R2(sum(X, gcr))), num(R2(sum(X, outs))), X.filter(x => dues(x) === "OVERDUE").length,
      X.filter(x => x.ap === "Awaiting Approval").length, X.length, bg ? Math.round(exp / bg * 100) + "%" : "–"];
  });
  const tot = D.cos.map((c, i) => { const f = x => String(x.c) === String(i + 1) && inF(x.d); return i; }).length;
  return `<h1>Managers</h1><p class="mu" style="margin:-8px 0 10px">Scorecard — ${esc(fy)}</p>
  ${rows.length ? `<div class="tw"><table><thead><tr><th>Manager</th><th>Company</th><th>Income</th><th>Expense</th><th>Profit</th><th>Margin</th><th>GST paid</th><th>Pending</th><th>Overdue</th><th>Await</th><th>Bills</th><th>Budget</th></tr></thead>
  <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : empty}
  ${isS() ? `<div class="acts"><button class="btn g" onclick="settings()">⚙ Settings</button></div>` : ""}`;
}
