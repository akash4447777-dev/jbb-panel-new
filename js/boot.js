"use strict";
/* ============================================================================
   JBB PANEL — forms, settings, exports, auth screens, boot
   ========================================================================== */

/* ---------------- generic record form ----------------
   F  = [[key,label,type,options]]   type: text|number|date|sel
   o  = current record (or defaults)
   ok = validate+apply callback; return false to block
   del = delete callback (new records pass null) */
function form(title, F, o, ok, del) {
  const field = ([k, l, ty, op]) => {
    const opts = typeof op === "function" ? op(o) : (Array.isArray(op) ? op : null);
    if (ty === "sel") {
      return `<label>${esc(l)}</label><select id="f_${k}">${opts.map(([v, n]) =>
        `<option value="${esc(v)}" ${String(v) === String(o[k]) ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
    }
    if (opts) {  // datalist
      return `<label>${esc(l)}</label><input id="f_${k}" type="${ty}" value="${esc(o[k])}" list="dl_${k}">
        <datalist id="dl_${k}">${opts.map(v => `<option value="${esc(Array.isArray(v) ? v[0] : v)}">`).join("")}</datalist>`;
    }
    return `<label>${esc(l)}</label><input id="f_${k}" type="${ty}" ${ty === "number" ? 'inputmode="decimal"' : ""} value="${esc(o[k] == null ? "" : o[k])}">`;
  };
  dlg(`<b class="t">${esc(title)}</b>${F.map(field).join("")}
    <div class="err" id="f_err"></div>
    <div class="acts">${del ? '<button class="btn red" id="f_del">Delete</button>' : ""}
      <button class="btn g" onclick="closeDlg()">Cancel</button>
      <button class="btn" id="f_save">Save</button></div>`);
  /* dependent selects */
  const cs = $("#f_c");
  if (cs && $("#f_tr")) cs.onchange = () => {
    $("#f_tr").innerHTML = trOpts(cs.value).map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join("");
  };
  const cat = $("#f_cat");
  if (cat && $("#f_sub")) cat.onchange = () => {
    $("#f_sub").innerHTML = (D.m.sub[cat.value] || []).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  };
  $("#f_save").onclick = () => {
    const r = {};
    for (const [k, , ty] of F) {
      const v = $("#f_" + k).value;
      r[k] = ty === "number" ? +v || 0 : v;
    }
    if (ok(r) !== false) { closeDlg(); }
  };
  if (del) $("#f_del").onclick = () => ask("Ye record delete karein? Wapas nahi aayega.", () => { del(); closeDlg(); });
}

/* create-or-edit helper, mirrors the original panel's `edit()` */
function edit(col, F, def, id, required) {
  const rec = id ? D[col].find(x => String(x.id) === String(id)) : Object.assign({}, def);
  if (id && !rec) return say("Record nahi mila");
  form(id ? "Edit" : "New", F, rec, r => {
    const miss = [].concat(required || []).filter(k => r[k] === "" || r[k] == null);
    if (miss.length) {
      showFormErr("f_err", "Zaroori: " + miss.map(k => (F.find(f => f[0] === k) || [])[1] || k).join(", "));
      return false;
    }
    if (id) Object.assign(rec, r);
    else {
      const n = Object.assign({ id: takeId() }, def, r);
      if (col === "ex") n.no = D.nx++;
      if (col === "inc") n.no = D.ni++;
      D[col].push(n);
    }
    commit(); render();
  }, id ? () => {
    D[col] = D[col].filter(x => String(x.id) !== String(id));
    commit(); render();
  } : null);
}

/* ---------------- field definitions ---------------- */
const FW = [["n", "Name", "text"], ["c", "Manager", "sel", () => copts()], ["wg", "Daily wage (₹)", "number"],
  ["r", "Role", "text"], ["ph", "Mobile", "text"], ["em", "Email", "text"]];
const FA = [["w", "Worker", "sel", () => D.w.map(w => [w.id, w.n])], ["d", "Date", "date"],
  ["t", "Type", "sel", () => [["g", "Advance given"], ["r", "Returned / deducted"], ["n", "Jama / Nill (not counted)"]]],
  ["amt", "Amount (₹)", "number"], ["note", "Note", "text"]];
const FX = [["d", "Date", "date"], ["c", "Manager", "sel", () => copts()], ["br", "Branch / Shop", "sel", () => lopt("br")],
  ["dp", "Department", "sel", () => lopt("dep")], ["cat", "Category", "sel", () => lopt("cat")],
  ["sub", "Sub-category", "sel", () => (D.m.sub[(D.ex.find(x => x.id) || {}).cat] || (D.m.sub[D.m.cat[0]] || []).map(s => [s, s]))],
  ["v", "Vendor / Payee", "text", o => uniq(D.ex.map(x => x.v).filter(Boolean))],
  ["ds", "Description", "text"], ["inv", "Invoice no", "text"],
  ["amt", "Amount ex-GST (₹)", "number"], ["g", "GST rate", "sel", () => D.m.gst.map(g => [g, Math.round(g * 100) + "%"])],
  ["md", "Payment mode", "sel", () => lopt("md")], ["st", "Payment status", "sel", () => PS.map(x => [x, x])],
  ["pp", "Part paid ₹ (if Partial)", "number"], ["due", "Due date", "date"], ["ap", "Approval", "sel", () => AS.map(x => [x, x])]];
const FI = [["d", "Date", "date"], ["c", "Manager", "sel", () => copts()], ["br", "Branch / Shop", "sel", () => lopt("br")],
  ["src", "Income source", "sel", () => lopt("src")], ["party", "Customer / Party", "text", o => uniq(D.inc.map(x => x.party).filter(Boolean))],
  ["md", "Payment mode", "sel", () => lopt("md")], ["ref", "Invoice / Ref", "text"],
  ["amt", "Amount ex-GST (₹)", "number"], ["g", "GST rate", "sel", () => D.m.gst.map(g => [g, Math.round(g * 100) + "%"])],
  ["st", "Status", "sel", () => IS.map(x => [x, x])]];
const FMP = [["d", "Date of transfer", "date"], ["c", "Manager", "sel", () => copts()], ["amt", "Amount sent (₹)", "number"], ["rem", "Remarks", "text"]];
const FFA = [["d", "Advance date", "date"], ["c", "Manager", "sel", () => copts()],
  ["tr", "From transfer", "sel", () => trOpts(null)], ["w", "Worker", "text", o => D.w.filter(w => co === "0" || String(w.c) === String(co)).map(w => w.n)],
  ["amt", "Amount (₹)", "number"], ["rem", "Remark", "text"]];
const FS = [["n", "Name", "text"]];

function trOpts(c) {
  const list = D.mp.filter(t => c == null || String(t.c) === String(c));
  return [["0", "— no transfer —"]].concat(list.map(t => [t.id, t.d + " · ₹" + num(t.amt) + " · " + cn(t.c)]));
}

/* ---------------- add / edit entry points ---------------- */
const dc = () => co !== "0" ? co : (cosOn()[0] || { c: "1" }).c;
const db = () => br !== "0" ? br : (D.m.br[0] || "");
const dd = () => dp !== "0" ? dp : (D.m.dep[0] || "");
const gdef = () => D.m.gst.includes(0.18) ? 0.18 : (D.m.gst[0] || 0);

const addW = id => edit("w", FW, { n: "", c: dc(), wg: 0, r: "" }, id, ["n"]);
const addA = id => {
  if (!D.w.length) return say("Pehle workers add karein");
  edit("adv", FA, { d: today(), t: "g", amt: 0, note: "", w: (D.w.find(w => co === "0" || String(w.c) === String(co)) || D.w[0]).id }, id, ["amt"]);
};
function addAOn(wid, day) {
  edit("adv", FA, { d: gm + "-" + pad2(day), t: "g", amt: 0, note: "", w: wid }, null, ["amt"]);
}
const addX = id => edit("ex", FX, { d: today(), c: dc(), br: db(), dp: dd(), cat: D.m.cat[0], sub: (D.m.sub[D.m.cat[0]] || [])[0] || "", v: "", ds: "", inv: "", amt: 0, g: gdef(), md: D.m.md[0], st: "Paid", pp: 0, due: "", ap: "Approved" }, id, ["d", "c", "br", "dp", "cat", "v", "amt", "md", "st", "ap"]);
const addI = id => edit("inc", FI, { d: today(), c: dc(), br: db(), src: D.m.src[0], party: "", md: D.m.md[0], ref: "", amt: 0, g: gdef(), st: "Received" }, id, ["d", "c", "br", "src", "md", "amt", "st"]);
const addMP = id => edit("mp", FMP, { d: today(), c: dc(), amt: 0, rem: "" }, id, ["d", "c", "amt"]);
const addFA = id => edit("fa", FFA, { d: today(), c: dc(), tr: 0, w: "", amt: 0, rem: "" }, id, ["d", "c", "w", "amt"]);
const addS = id => edit("s", FS, { n: "", g: as }, id, ["n"]);

function bulk() {
  dlg(`<b class="t">Bulk add workers</b>
    <label>Manager</label><select id="bc">${copts().map(([v, n]) => `<option value="${v}" ${v === dc() ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
    <label>Ek line me ek: name, daily wage, role</label>
    <textarea id="bt" rows="9" placeholder="Ali Khan, 800, Mason"></textarea>
    <div class="acts"><button class="btn g" onclick="closeDlg()">Cancel</button><button class="btn" id="bs">Add</button></div>`);
  $("#bs").onclick = () => {
    const c = $("#bc").value;
    let n = 0;
    for (const line of $("#bt").value.split("\n")) {
      const p = line.split(",").map(s => s.trim());
      if (!p[0]) continue;
      D.w.push({ id: takeId(), n: p[0], c, wg: +p[1] || 0, r: p[2] || "" });
      n++;
    }
    closeDlg();
    save().then(() => { toast(n + " workers add hue"); render(); });
  };
}

/* ---------------- exports ---------------- */
function csvFile(name, heads, rows) {
  const csv = [heads, ...rows].map(r => r.map(v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"').join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name + "-" + today() + ".csv";
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  toast("Download shuru hua");
}

/* attendance PDF: print-based, no external library */
function attPdf(wid, kind) {
  const w = kind === "w" ? D.w.find(x => x.id === wid) : D.s.find(x => x.id === wid);
  if (!w) return;
  const month = kind === "w" ? date.slice(0, 7) : gm;
  const rows = [];
  let p = 0, h = 0, a = 0;
  const nd = daysInMonth(month);
  for (let d = 1; d <= nd; d++) {
    const dt = month + "-" + pad2(d), st = D.a[dt + "|" + w.id] || "", t = D.t[dt + "|" + w.id] || {};
    st === "P" ? p++ : st === "H" ? h++ : st === "A" && a++;
    rows.push([pad2(d), weekday(month, d), isSunday(month, d) ? "Sun" : "", { P: "Present", H: "Half", A: "Absent" }[st] || "—", t.i ? fmtT(t.i) : "", t.o ? fmtT(t.o) : "", mins(t.i, t.o) ? (mins(t.i, t.o) / 60).toFixed(1) : ""]);
  }
  printReport(`${w.n} — Attendance ${mnOf(month + "-01")} ${month.slice(0, 4)}`, {
    sub: (kind === "w" ? cn(w.c) : (w.g === "o" ? "Office staff" : "Manager")) || "",
    heads: ["Day", "Week", "", "Status", "In", "Out", "Hours"],
    rows,
    foot: `Present ${p} · Half ${h} · Absent ${a} · Worked days ${p + h / 2}`
  });
}

function attPdfAll(kind) {
  const list = kind === "w"
    ? D.w.filter(w => (co === "0" || String(w.c) === String(co)) && qmatch(w.n))
    : D.s.filter(s => s.g === as && qmatch(s.n));
  if (!list.length) return say("Koi record nahi mila");
  const month = kind === "w" ? date.slice(0, 7) : gm;
  const rows = [], nd = daysInMonth(month);
  for (const w of list) {
    let p = 0, h = 0, a = 0;
    for (let d = 1; d <= nd; d++) {
      const st = D.a[month + "-" + pad2(d) + "|" + w.id] || "";
      st === "P" ? p++ : st === "H" ? h++ : st === "A" && a++;
    }
    rows.push([w.n, kind === "w" ? cn(w.c) : "", p, h, a, p + h / 2]);
  }
  printReport(`Attendance summary — ${mnOf(month + "-01")} ${month.slice(0, 4)}`, {
    heads: ["Name", "Manager", "Present", "Half", "Absent", "Worked days"],
    rows,
    foot: `${list.length} people`
  });
}

function attExcelAll(kind) {
  const list = kind === "w" ? D.w.filter(w => co === "0" || String(w.c) === String(co)) : D.s.filter(s => s.g === as);
  const month = kind === "w" ? date.slice(0, 7) : gm;
  const nd = daysInMonth(month);
  const heads = ["Name", "Manager"].concat(Array.from({ length: nd }, (_, i) => pad2(i + 1))).concat(["P", "H", "A", "Worked"]);
  const rows = list.map(w => {
    let p = 0, h = 0, a = 0;
    const days = Array.from({ length: nd }, (_, i) => {
      const st = D.a[month + "-" + pad2(i + 1) + "|" + w.id] || "";
      st === "P" ? p++ : st === "H" ? h++ : st === "A" && a++;
      return st;
    });
    return [w.n, kind === "w" ? cn(w.c) : "", ...days, p, h, a, p + h / 2];
  });
  csvFile("attendance-" + month, heads, rows);
}
function attExcel(wid) { attPdf(wid, "w"); }

function payPdf() {
  const rows = payRows();
  printReport("Payroll — " + gm, {
    sub: co === "0" ? "All managers" : cn(co),
    heads: ["Worker", "Manager", "Days", "Wage", "Earned", "Advance", "Net payable"],
    rows: rows.map(r => [r.w.n, cn(r.c), r.days, num(r.w.wg), num(r.earned), num(r.adv), num(r.net)]),
    foot: `Earned ${num(sum(rows, "earned"))} · Advances ${num(sum(rows, "adv"))} · Net ${num(sum(rows, "earned") - sum(rows, "adv"))}`
  });
}

/* print-to-PDF helper: opens a clean printable window */
function printReport(title, o) {
  const w = window.open("", "_blank");
  if (!w) return say("Pop-up block ho gaya — browser me allow karein");
  const style = `body{font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:22px}
    h1{font-size:17px;margin:0 0 2px}h2{font-size:12px;margin:0 0 12px;color:#666;font-weight:500}
    table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ccc;padding:4px 6px;text-align:right}
    th:first-child,td:first-child{text-align:left}th{background:#f3f4f6;font-weight:700}
    tfoot td{font-weight:700;background:#f9fafb}.foot{margin-top:12px;font-size:11px;color:#333}
    @media print{body{margin:8mm}}`;
  const table = `<table><thead><tr>${o.heads.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${o.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${style}</style></head>
    <body><h1>${esc(title)}</h1><h2>${esc(o.sub || "")} · Generated ${esc(today())}</h2>${table}
    ${o.foot ? `<div class="foot">${esc(o.foot)}</div>` : ""}
    <script>window.onload=()=>{setTimeout(()=>window.print(),250)}<\/script></body></html>`);
  w.document.close();
}

/* ---------------- Settings (Super Admin) ---------------- */
function settings() {
  if (!isS()) return say("Sirf Super Admin Settings khol sakta hai");
  const ta = (id, l, v, r) => `<label>${esc(l)}</label><textarea id="${id}" rows="${r || 3}">${esc(v)}</textarea>`;
  dlg(`<b class="t">Settings</b>
  ${D.cos.map((c, i) => `<label>Manager ${i + 1}: name / company${c.x ? " (hidden)" : ""}</label>
    <div style="display:flex;gap:6px;align-items:center">
      <input id="cm${i}" value="${esc(c.m)}"><input id="cn${i}" value="${esc(c.n || "")}">
      <label style="display:flex;align-items:center;gap:4px;margin:0;white-space:nowrap"><input type="checkbox" id="ca${i}" style="width:auto" ${c.x ? "" : "checked"}>On</label>
    </div>`).join("")}
  <label>Naya manager</label><div style="display:flex;gap:6px"><input id="nm" placeholder="Manager name"><input id="nc" placeholder="Company (optional)"><button class="btn" id="am">Add</button></div>
  <small>On hataane se manager dropdown se hide ho jata hai. Purane entries safe rehte hain.</small>
  ${ta("mc", "Categories (Category: sub1, sub2 — ek line me ek)", D.m.cat.map(c => c + ": " + (D.m.sub[c] || []).join(", ")).join("\n"), 8)}
  ${ta("mb", "Branches / shops (ek line me ek)", D.m.br.join("\n"))}
  ${ta("mdp", "Departments", D.m.dep.join("\n"))}
  ${ta("mm", "Payment modes", D.m.md.join("\n"))}
  ${ta("ms", "Income sources", D.m.src.join("\n"))}
  <label>GST rates % (comma separated)</label><input id="mg" value="${D.m.gst.map(x => Math.round(x * 100)).join(", ")}">
  <label style="display:flex;gap:8px;align-items:flex-start;margin-top:12px"><input type="checkbox" id="pw" style="width:auto;margin-top:3px" ${D.opt.pw ? "checked" : ""}>
    <span>Profit me attendance payroll bhi ghatao (sirf tab jab wages Salary expense me na daali ho)</span></label>
  <h2 class="mt">Storage</h2>
  <label>Data kahan rakhein</label>
  <div class="bar">
    <button class="btn ${MODE === "local" ? "" : "g"}" onclick="setMode('local')" style="flex:1">📱 Isi device me (Offline)</button>
    <button class="btn ${MODE === "cloud" ? "" : "g"}" onclick="setMode('cloud')" style="flex:1">☁ Server (Cloud)</button>
  </div>
  <small>${MODE === "local"
    ? "Offline: data sirf isi browser me hai. Doosre phone/laptop ke saath share nahi hota — backup lekar rakhein."
    : "Cloud: data server par hai, sab device par same dikhta hai. Server band ho to panel nahi chalega."}</small>
  <label>Cloud server address</label>
  <div style="display:flex;gap:6px">
    <input id="cb" value="${esc(cloudBase())}" placeholder="https://your-app.onrender.com">
    <button class="btn" id="cbs">Set</button>
  </div>
  <small>Panel isi server se baat karega. Khali chhodo to wahi server jahan panel khud chal raha hai.</small>
  ${ta("bk", "Backup — ye text copy karein. Restore ke liye paste karke Restore dabayein.", JSON.stringify(D), 3)}
  <div class="acts"><button class="btn g" id="rs">Restore</button>
    <button class="btn g" id="exp">Export backup</button>
    <button class="btn" id="sv">Save</button></div>
  <h2 class="mt">Users</h2><div id="usr"></div>`);

  const applyMg = () => D.cos.forEach((c, i) => {
    c.m = $("#cm" + i).value.trim() || c.m;
    c.n = $("#cn" + i).value.trim() || c.n || c.m;
    c.x = $("#ca" + i).checked ? 0 : 1;
  });
  $("#am").onclick = () => {
    applyMg();
    const nm = $("#nm").value.trim().toUpperCase();
    if (!nm) return say("Manager ka naam likhein");
    if (D.cos.some(c => String(c.m).toUpperCase() === nm)) return say("Ye manager pehle se hai");
    D.cos.push({ m: nm, n: $("#nc").value.trim() || nm, x: 0 });
    D.s.push({ id: takeId(), n: nm, g: "m" });
    save().then(() => { settings(); render(); });
  };
  $("#sv").onclick = () => {
    const lines = id => $("#" + id).value.split("\n").map(s => s.trim()).filter(Boolean);
    applyMg();
    const p = parseCats($("#mc").value);
    if (p.cat.length) { D.m.cat = p.cat; D.m.sub = p.sub; }
    [["br", "mb"], ["dep", "mdp"], ["md", "mm"], ["src", "ms"]].forEach(([k, id]) => { const v = lines(id); if (v.length) D.m[k] = v; });
    const g = $("#mg").value.split(",").map(s => parseFloat(s) / 100).filter(x => x >= 0);
    if (g.length) D.m.gst = g;
    D.opt.pw = $("#pw").checked ? 1 : 0;
    save().then(() => { closeDlg(); toast("Settings save hue"); render(); });
  };
  $("#rs").onclick = () => {
    let x;
    try { x = JSON.parse($("#bk").value); } catch (e) { return say("Backup text valid JSON nahi hai"); }
    if (!x || !Array.isArray(x.w) || !Array.isArray(x.cos)) return say("Ye panel ka backup nahi lagta");
    ask("Purana data replace ho jayega. Aage badhein?", () => {
      const users = D.u; D = x; migrate(); D.u = users;
      save().then(() => { closeDlg(); toast("Restore ho gaya"); render(); });
    });
  };
  $("#cbs").onclick = () => {
    const v = ($("#cb").value || "").trim().replace(/\/+$/, "");
    setPrefs({ cloudBase: v });
    toast(v ? "Server set ho gaya" : "Server hata diya");
  };
  $("#exp").onclick = () => {
    const blob = new Blob([JSON.stringify(D, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "jbb-backup-" + today() + ".json";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  };

  renderUsers();
}

async function renderUsers() {
  const box = document.getElementById("usr");
  if (!box) return;
  let users = [];
  if (MODE === "local") {
    const db = dbLoadSync();
    users = Object.values((db && db.users) || {});
  } else {
    const r = await api("GET", "/users");
    users = (r.users || []).map(u => ({ id: u.id, name: u.name, role: u.role, status: u.status }));
  }
  box.innerHTML = users.length ? `<table><thead><tr><th>Id</th><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr><td>${esc(u.id)}</td><td>${esc(u.name)}</td><td>${esc(ROLES[u.role] || u.role)}</td>
      <td>${pill(u.status, u.status === "active" ? "ok" : u.status === "pending" ? "wn" : "bad")}</td>
      <td>${String(u.id) === String(ME.id) ? "—" : `
        ${u.status === "pending" ? `<button class="btn g sm" onclick="userAct('${esc(u.id)}','approve')">Approve</button>` : ""}
        ${u.status === "active" ? `<button class="btn g sm" onclick="userAct('${esc(u.id)}','block')">Block</button>` : ""}
        ${u.status === "blocked" ? `<button class="btn g sm" onclick="userAct('${esc(u.id)}','unblock')">Unblock</button>` : ""}
        <button class="btn g sm" onclick="userAct('${esc(u.id)}','remove')">Remove</button>`}</td></tr>`).join("")}
    </tbody></table>` : '<p class="mu">Sirf aap ho.</p>';
}
function dbLoadSync() { try { return JSON.parse(localStorage.getItem(LKEY) || "null"); } catch (e) { return null; } }

async function userAct(uid, act) {
  if (MODE === "local") {
    const db = dbLoadSync() || localDbInit();
    const u = db.users[String(uid)];
    if (!u) return say("User nahi mila");
    if (act === "approve") { u.status = "active"; u.role = "admin"; }
    else if (act === "block") u.status = "blocked";
    else if (act === "unblock") u.status = "active";
    else if (act === "remove") delete db.users[String(uid)];
    dbSaveLocal(db);
    toast("Ho gaya"); renderUsers();
    return;
  }
  const r = await api("POST", "/users/act", { uid, act });
  if (!r.ok) return say(r.error || "Fail");
  toast("Ho gaya"); renderUsers();
}

/* ---------------- filter bar ---------------- */
function filters(t) {
  const o = (v, l, s) => `<option value="${esc(v)}" ${String(v) === String(s) ? "selected" : ""}>${esc(l)}</option>`;
  const isStaff = tab === "att" && as !== "w";
  let h = "";
  if (!isStaff) h += `<select onchange="co=this.value;lim=100;render()">${copts(true).map(([v, n]) => o(v, n, co)).join("")}</select>`;
  if (tab === "att" && !isStaff) h += `<input type="date" value="${esc(date)}" onchange="date=this.value||date;render()">`;
  if (tab === "att" && isStaff) h += `<input type="month" value="${esc(gm)}" onchange="gm=this.value||gm;render()">`;
  if (tab === "adv" || tab === "pay") h += `<input type="month" value="${esc(gm)}" onchange="gm=this.value||gm;render()">`;
  if (t.b) h += `<select onchange="br=this.value;lim=100;render()">${[["0", "All branches"]].concat(D.m.br.map(x => [x, x])).map(([v, n]) => o(v, n, br)).join("")}</select>`;
  if (t.p === 1 || t.p === 2) h += `<select onchange="fy=this.value;lim=100;render()">${FYS.map(x => o(x, x, fy)).join("")}</select>`;
  if (t.p === 2) h += `<select onchange="mn=this.value;lim=100;render()">${[["All", "All months"]].concat(FM.map(x => [x, x])).map(([v, n]) => o(v, n, mn)).join("")}</select>`;
  return `<div class="filters">${h}</div>`;
}

/* ---------------- shell ---------------- */
const T = {
  dash: { t: "Dashboard", i: "▦", p: 2, list: dashL, top: () => "" },
  work: { t: "Workers", i: "👷", p: 0, list: workL, top: () => sb("Search workers", addB("addW()", "+ Add") + `<button class="btn g" onclick="bulk()">Bulk</button>`) },
  att: { t: "Attendance", i: "📅", p: 0, list: () => as === "w" ? attL() : staffL(), top: attTop },
  adv: { t: "Advances", i: "💸", p: 2, nm: 1, list: advL, top: advTop },
  fund: { t: "Manager Funds", i: "🏦", p: 0, list: fundL, top: fundTop },
  pay: { t: "Payroll", i: "🧾", p: 2, list: payL, top: payTop },
  sa: { t: "Settlements", i: "✅", p: 0, list: saL, top: saTop },
  ex: { t: "Expenses", i: "📉", p: 2, b: 1, list: exL, top: exTop },
  inc: { t: "Income", i: "📈", p: 2, b: 1, list: incL, top: incTop },
  bud: { t: "Budget", i: "🎯", p: 1, list: budL, top: () => "" },
  mgr: { t: "Managers", i: "🏢", p: 1, list: mgrL, top: () => "" },
  rep: { t: "Reports", i: "📊", p: 1, b: 1, list: repL, top: () => "" }
};
const TB = Object.keys(T);

function go(k) { tab = k; q = ""; lim = 100; render(); }

function header() {
  const mode = MODE === "local"
    ? '<span class="pill wn">Offline</span>'
    : '<span class="pill ok">Cloud</span>';
  document.getElementById("hdr").innerHTML =
    `<span class="brand">${esc(D.opt && D.opt.title ? D.opt.title : "JBB PANEL")}</span>
     <span class="user">${mode}<b>${esc(ME && ME.name ? ME.name : "User")}</b>${ME && ROLES[ME.role] ? "· " + esc(ROLES[ME.role]) : ""}
     <button class="hbtn" id="btnSettings">Settings</button>
     <button class="hbtn" id="btnLogout">Logout</button></span>`;
  $("#btnLogout").onclick = () => { setToken(""); location.reload(); };
  $("#btnSettings").onclick = settings;
}
function navBar() {
  document.getElementById("nav").innerHTML = TB.map(k =>
    `<button class="${tab === k ? "on" : ""}" onclick="go('${k}')"><i>${T[k].i}</i>${esc(T[k].t)}</button>`).join("");
}
function render() {
  if (!ME) return showLogin();
  header(); navBar();
  const t = T[tab] || T.dash;
  document.getElementById("screen").innerHTML = filters(t) + t.top() + t.list();
}
function upd() {
  const t = T[tab] || T.dash;
  document.getElementById("screen").innerHTML = filters(t) + t.top() + t.list();
}
function keepScroll() {
  const y = window.scrollY;
  upd();
  window.scrollTo(0, y);
}

/* ---------------- login / setup ---------------- */
function lgShow(html) {
  document.getElementById("hdr").innerHTML = "";
  document.getElementById("nav").innerHTML = "";
  document.getElementById("screen").innerHTML = `<div class="login-wrap"><div class="login-card">${html}</div></div>`;
}
function showLogin() {
  const modeLine = MODE === "local" ? "Offline mode — data isi device me" : "Cloud mode — " + esc(cloudBase() || "same server");
  lgShow(`<h1>${esc(D.opt && D.opt.title ? D.opt.title : "JBB PANEL")}</h1>
    <p class="sub">Gmail / mobile number aur password se sign in</p>
    <span class="badge-mode">${modeLine}</span>
    <div class="err" id="le"></div>
    <label>Gmail / Mobile number</label><input id="lu" autocomplete="username" placeholder="you@gmail.com ya 9876543210">
    <label>Password</label><input id="lp" type="password" autocomplete="current-password" placeholder="Kam se kam 6 characters">
    <div class="acts"><button class="btn big" id="lb">Sign in</button></div>
    <p class="mu mt" style="text-align:center">Pehla account Super Admin banta hai. Baaki accounts approval ka wait karte hain.</p>`);
  const go_ = () => doLogin();
  $("#lb").onclick = go_;
  ["lu", "lp"].forEach(id => { $("#" + id).onkeydown = e => { if (e.key === "Enter") go_(); }; });
}
async function doLogin() {
  const id = $("#lu").value.trim(), pw = $("#lp").value;
  const err = $("#le");
  err.classList.remove("on");
  if (!id) return showFormErr("le", "Gmail ya mobile number likhein");
  if (pw.length < 6) return showFormErr("le", "Password kam se kam 6 characters ka hona chahiye");
  const b = $("#lb");
  b.disabled = true; b.textContent = "Signing in…";
  const r = await api("POST", "/auth/login", { id, password: pw });
  b.disabled = false; b.textContent = "Sign in";
  if (!r.token) return showFormErr("le", r.error || (r._s === 0 ? "Server se connection nahi bana" : "Login nahi hua"));
  setToken(r.token);
  ME = { id: r.user ? r.user.id : id, name: r.user ? r.user.name : id, role: r.user ? r.user.role : "admin" };
  const lr = await loadData();
  if (lr._s === 401) { setToken(""); ME = null; return showLogin(); }
  if (lr._s === 0) return showFormErr("le", "Server se connection nahi bana");
  if (lr._s === 403 || lr._s === 500) { /* proceed with what we have */ }
  tab = "dash"; render();
}
function authFail() { setToken(""); ME = null; showLogin(); }

/* ---------------- boot ---------------- */
async function start() {
  const r = await loadData();
  if (r._s === 401 || r._s === 403) { authFail(); return; }
  if (r._s === 0) { authFail(); return; }
  render();
}

(function boot() {
  document.addEventListener("DOMContentLoaded", () => {
    const t = localStorage.getItem(TOK);
    if (!ME && t) {
      /* trust the stored session shape, then verify with the server */
      if (t.indexOf("local:") === 0) {
        const u = localUser();
        if (u) ME = { id: u.id, name: u.name, role: u.role };
      } else {
        try {
          const body = JSON.parse(atob(t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
          ME = { id: body.sub, name: String(body.sub || "").split("@")[0], role: body.role || "admin" };
        } catch (e) {}
      }
    }
    if (ME || t) start(); else { D = migrate(); showLogin(); }
  });
})();
