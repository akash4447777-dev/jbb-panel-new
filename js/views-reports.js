"use strict";
/* ============================================================================
   JBB PANEL — views: Reports (ageing, GST, vendor outstanding)
   + shared matrix/report builders
   ========================================================================== */

function repL() {
  const X = D.ex.filter(fxF), I = D.inc.filter(x => inScope(x) && inF(x.d));
  const bills = ageing().filter(b => inScope({ c: b.c, br: b.br }) && b.d && fyOf(b.d) === fy);
  const ag = ageingBuckets(bills.filter(b => b.kind === "exp"));
  const agi = ageingBuckets(bills.filter(b => b.kind === "inc"));

  /* vendor outstanding */
  const V = {};
  for (const b of bills.filter(b => b.kind === "exp" && b.out > 0 && b.approval !== "Rejected")) {
    const k = b.party || "(no vendor)";
    const r = V[k] = V[k] || { bill: 0, paid: 0, out: 0, od: 0 };
    r.bill += b.gross; r.paid += b.paid; r.out += b.out;
    if (b.overdue) r.od++;
  }
  const vrows = Object.entries(V).sort((a, b) => b[1].out - a[1].out)
    .map(([k, r]) => [esc(k), num(r.bill), num(r.paid), `<b class="neg">${num(r.out)}</b>`, r.od]);

  /* GST — for the selected financial year */
  const gst = gstSummary(fyStartDate(fy), fyEndDate(fy));

  /* category × manager matrix */
  const catMgr = (D.m.cat || []).map(c => {
    const cells = D.cos.map((co_, i) => `<td>${num(R2(sum(X.filter(x => x.cat === c && String(x.c) === String(i + 1)), net)))}</td>`).join("");
    return `<tr><td>${esc(c)}</td>${cells}<td><b>${num(R2(sum(X.filter(x => x.cat === c), net)))}</b></td></tr>`;
  });
  /* manager × month matrix */
  const mgrMonth = D.cos.map((co_, i) => {
    const cells = FM.map(m => {
      const v = R2(sum(X.filter(x => String(x.c) === String(i + 1) && mnOf(x.d) === m), net));
      return `<td>${v ? num(v) : ""}</td>`;
    }).join("");
    return `<tr><td>${esc(co_.m)}</td>${cells}<td><b>${num(R2(sum(X.filter(x => String(x.c) === String(i + 1)), net)))}</b></td></tr>`;
  });

  return `<h1>Reports</h1><p class="mu" style="margin:-8px 0 10px">${esc(fy)} · ${co === "0" ? "All managers" : esc(cn(co))}</p>

  <div class="grid">${kp("Expense", rs(R2(sum(X, net))))}${kp("Income", rs(R2(sum(I, "amt"))))}${kp("GST net", rs(gst.totalNet), cl(-gst.totalNet))}${kp("Overdue payable", rs(R2(ag.overdue)), ag.overdue ? "neg" : "")}</div>

  ${hd("Ageing — payable (expenses)")}
  <div class="tw"><table><thead><tr><th>Bucket</th><th>Amount</th></tr></thead><tbody>
    <tr><td>Not due / current</td><td>${num(R2(ag.age0))}</td></tr>
    <tr><td>1–30 days late</td><td>${num(R2(ag.age30))}</td></tr>
    <tr><td>31–60 days late</td><td>${num(R2(ag.age60))}</td></tr>
    <tr><td>61–90 days late</td><td>${num(R2(ag.age90))}</td></tr>
    <tr><td>90+ days late</td><td><b class="neg">${num(R2(ag.over90))}</b></td></tr>
    <tr><td>No due date set</td><td>${num(R2(ag.missingDue))}</td></tr>
    <tr><td><b>Total outstanding</b></td><td><b>${num(R2(ag.age0 + ag.age30 + ag.age60 + ag.age90 + ag.over90 + ag.missingDue))}</b></td></tr>
  </tbody></table></div>

  ${hd("Ageing — receivable (income)")}
  <div class="tw"><table><thead><tr><th>Bucket</th><th>Amount</th></tr></thead><tbody>
    <tr><td>Not due / current</td><td>${num(R2(agi.age0))}</td></tr>
    <tr><td>1–30 days late</td><td>${num(R2(agi.age30))}</td></tr>
    <tr><td>31–60 days late</td><td>${num(R2(agi.age60))}</td></tr>
    <tr><td>61–90 days late</td><td>${num(R2(agi.age90))}</td></tr>
    <tr><td>90+ days late</td><td><b class="neg">${num(R2(agi.over90))}</b></td></tr>
  </tbody></table></div>

  ${hd("GST — " + fy)}
  <div class="tw"><table><thead><tr><th>Rate</th><th>Input (expense)</th><th>Output (income)</th><th>Net payable</th></tr></thead><tbody>
  ${gst.rows.map(r => `<tr><td>${Math.round(r.rate * 100)}%</td><td>${num(r.input)}</td><td>${num(r.output)}</td><td><b class="${cl(-r.net)}">${num(r.net)}</b></td></tr>`).join("")}
  <tr><td><b>Total</b></td><td><b>${num(gst.totalInput)}</b></td><td><b>${num(gst.totalOutput)}</b></td><td><b class="${cl(-gst.totalNet)}">${num(gst.totalNet)}</b></td></tr>
  </tbody></table></div>

  ${vrows.length ? hd("Vendor outstanding") + tbl(["Vendor", "Billed", "Paid", "Outstanding", "Overdue"], vrows) : ""}

  ${D.cos.length ? hd("Net expense: manager × month") + `<div class="tw"><table><thead><tr><th>Manager</th>${FM.map(m => `<th>${m}</th>`).join("")}<th>Total</th></tr></thead><tbody>${mgrMonth.join("")}</tbody></table></div>` : ""}

  ${D.cos.length ? hd("Net expense: category × manager") + `<div class="tw"><table><thead><tr><th>Category</th>${D.cos.map(c => `<th>${esc(c.m)}</th>`).join("")}<th>Total</th></tr></thead><tbody>${catMgr.join("")}</tbody></table></div>` : ""}`;
}

/* fiscal-year bounds for FY 2026-27 => 2026-04-01 .. 2027-03-31 */
function fyStartDate(f) {
  const y = +String(f).replace(/[^0-9]/g, "").slice(0, 4);
  return y + "-04-01";
}
function fyEndDate(f) {
  const y = +String(f).replace(/[^0-9]/g, "").slice(0, 4);
  return (y + 1) + "-03-31";
}
