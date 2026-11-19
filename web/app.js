const C = window.APP_CONFIG;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtD = d => d ? d.split("-").reverse().join(".") : "";
const stageName = s => (s || "").replace(/^\d+\s/, "");
let profile = null, charts = {}, page = 0, total = 0, lastFilter = null;
const PAGE = 50;

document.title = C.TITLE; $("#title").textContent = C.TITLE; $("#ltitle").textContent = C.TITLE;

/* ---------- auth ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: p } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
  if (!p || !p.active) { await sb.auth.signOut(); return showLogin("Your account is not active. Ask the admin."); }
  profile = p;
  $("#login").classList.add("hide"); $("#app").classList.remove("hide");
  $("#who").textContent = `${p.display_name || session.user.email} · ${p.role}${p.workshop ? " · " + p.workshop : ""}`;
  document.querySelectorAll(".editonly").forEach(e => e.classList.toggle("hide", p.role === "viewer"));
  loadStages(); loadOverview();
}
function showLogin(msg) { $("#app").classList.add("hide"); $("#login").classList.remove("hide"); $("#lerr").textContent = msg || ""; }
$("#lform").onsubmit = async e => {
  e.preventDefault(); $("#lerr").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("#em").value, password: $("#pw").value });
  if (error) $("#lerr").textContent = error.message; else boot();
};
$("#out").onclick = async () => { await sb.auth.signOut(); location.reload(); };

document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x === b));
  $("#t-ov").classList.toggle("hide", b.dataset.tab !== "ov");
  $("#t-rec").classList.toggle("hide", b.dataset.tab !== "rec");
  if (b.dataset.tab === "rec" && !lastFilter) loadRecords();
});

/* ---------- overview ---------- */
const num = n => (n ?? 0).toLocaleString("en-IN");
function table(el, head, rows, totalRow) {
  const h = "<thead><tr>" + head.map((x, i) => `<th class="${i ? "" : "l"}">${esc(x)}</th>`).join("") + "</tr></thead>";
  const body = rows.map(r => "<tr>" + r.map((v, i) => `<td class="${i ? "" : "l"}">${typeof v === "number" ? num(v) : esc(v)}</td>`).join("") + "</tr>").join("");
  const tot = totalRow ? "<tr class='tot'>" + totalRow.map((v, i) => `<td class="${i ? "" : "l"}">${typeof v === "number" ? num(v) : esc(v)}</td>`).join("") + "</tr>" : "";
  el.innerHTML = h + "<tbody>" + body + tot + "</tbody>";
}
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
function draw(id, cfg) { charts[id]?.destroy(); charts[id] = new Chart($(id), cfg); }

async function loadOverview() {
  const { data, error } = await sb.rpc("dashboard_stats", { p_from: $("#f_from").value || null, p_to: $("#f_to").value || null });
  if (error) return alert(error.message);
  const t = data.totals;
  $("#kpis").innerHTML = [
    ["Total PR", t.pr, ""], ["Issued", t.issued, ""], ["Replaced", t.replaced, "ok"],
    ["Pending issue", t.pending_issue, t.pending_issue ? "bad" : "ok"],
    ["Pending replacement", t.pending_replacement, t.pending_replacement ? "warn" : "ok"],
    ["Returned to workshop", t.returned, ""], ["Repaired", t.repaired, ""], ["In kitty (ready)", t.kitty, ""],
    ["Avg days PR→replace", t.avg_days_to_replace ?? "–", ""]
  ].map(([l, v, c]) => `<div class="kpi ${c}"><b>${typeof v === "number" ? num(v) : esc(v)}</b><span>${l}</span></div>`).join("");

  const W = data.by_workshop;
  table($("#tbl_ws"), ["Workshop", "PR", "Issued", "Replaced", "Pending issue", "Pending replacement", "Repaired", "In kitty"],
    W.map(r => [r.workshop, r.pr, r.issued, r.replaced, r.pending_issue, r.pending_replacement, r.repaired, r.kitty]),
    ["TOTAL", ...["pr", "issued", "replaced", "pending_issue", "pending_replacement", "repaired", "kitty"].map(k => sum(W, k))]);
  const D = data.by_division;
  table($("#tbl_div"), ["Workshop", "Division", "PR", "Issued", "Replaced", "Pending issue", "Pending replacement"],
    D.map(r => [r.workshop, r.division || "–", r.pr, r.issued, r.replaced, r.pending_issue, r.pending_replacement]));
  const K = data.by_capacity;
  table($("#tbl_cap"), ["kVA", "Azamgarh", "Mau", "Ballia", "Total"], K.map(r => [String(r.capacity_kva), r.azamgarh, r.mau, r.ballia, r.total]),
    ["TOTAL", ...["azamgarh", "mau", "ballia", "total"].map(k => sum(K, k))]);

  const cs = getComputedStyle(document.documentElement), ink = cs.getPropertyValue("--mute").trim(), brand = cs.getPropertyValue("--brand").trim(), ok = cs.getPropertyValue("--ok").trim();
  Chart.defaults.color = ink; Chart.defaults.borderColor = cs.getPropertyValue("--line").trim();
  draw("#c_stage", { type: "bar", data: { labels: data.by_stage.map(s => stageName(s.stage)), datasets: [{ data: data.by_stage.map(s => s.n), backgroundColor: brand }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } } } });
  draw("#c_month", { type: "bar", data: { labels: data.by_month.map(m => m.m), datasets: [
    { label: "PR received", data: data.by_month.map(m => m.pr), backgroundColor: brand },
    { label: "Replaced", data: data.by_month.map(m => m.replaced), backgroundColor: ok }] } });
  draw("#c_cause", { type: "bar", data: { labels: data.by_cause.map(m => m.cause), datasets: [{ data: data.by_cause.map(m => m.n), backgroundColor: brand }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } } } });
}
$("#f_go").onclick = loadOverview;
$("#f_all").onclick = () => { $("#f_from").value = $("#f_to").value = ""; loadOverview(); };

/* ---------- records ---------- */
async function loadStages() {
  const { data } = await sb.from("cases_v").select("stage").limit(1000);
  const all = ["1 PR received, issue pending", "2 Issued, replacement pending", "3 Replaced (damaged TX not returned)", "4 Returned to workshop", "5 Under repair", "6 Repaired", "7 Tested", "8 In kitty (ready)", "9 Re-issued"];
  $("#r_stage").innerHTML = '<option value="">All</option>' + all.map(s => `<option value="${esc(s)}">${esc(stageName(s))}</option>`).join("");
}
function applyFilters(q) {
  const s = $("#q").value.replace(/[,()%*]/g, " ").trim();
  if (s) q = q.or(["pr_no", "did_no", "feeder", "substation", "place_of_damage", "complain_no"].map(c => `${c}.ilike.%${s}%`).join(","));
  if ($("#r_ws").value) q = q.eq("workshop", $("#r_ws").value);
  if ($("#r_stage").value) q = q.eq("stage", $("#r_stage").value);
  if ($("#r_cap").value) q = q.eq("capacity_kva", +$("#r_cap").value);
  if ($("#r_from").value) q = q.gte("pr_date", $("#r_from").value);
  if ($("#r_to").value) q = q.lte("pr_date", $("#r_to").value);
  return q;
}
async function loadRecords() {
  lastFilter = true;
  let q = applyFilters(sb.from("cases_v").select("*", { count: "exact" }))
    .order("pr_date", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  const { data, count, error } = await q;
  if (error) return alert(error.message);
  total = count;
  window._rows = data;
  const cols = [["PR No", "pr_no"], ["PR date", "pr_date", 1], ["Workshop", "workshop"], ["Division", "division"], ["Substation", "substation"], ["Feeder", "feeder"], ["kVA", "capacity_kva"],
    ["Issued", "issue_date", 1], ["Replaced", "replacement_date", 1], ["Returned", "tx_return_date", 1], ["Stage", "stage"]];
  $("#tbl_rec").innerHTML = "<thead><tr>" + cols.map(c => `<th class="l">${c[0]}</th>`).join("") + "</tr></thead><tbody>" +
    data.map((r, i) => `<tr class="click" data-i="${i}">` + cols.map(c => `<td class="l">${c[0] === "Stage" ? `<span class="pill">${esc(stageName(r.stage))}</span>` : esc(c[2] ? fmtD(r[c[1]]) : r[c[1]])}</td>`).join("") + "</tr>").join("") + "</tbody>";
  $("#tbl_rec").querySelectorAll("tr.click").forEach(tr => tr.onclick = () => openForm(window._rows[+tr.dataset.i]));
  $("#pinfo").textContent = `${total ? page * PAGE + 1 : 0}–${Math.min((page + 1) * PAGE, total)} of ${num(total)}`;
  $("#pp").disabled = page === 0; $("#pn").disabled = (page + 1) * PAGE >= total;
}
$("#r_go").onclick = () => { page = 0; loadRecords(); };
$("#q").onkeydown = e => { if (e.key === "Enter") $("#r_go").click(); };
$("#pp").onclick = () => { page--; loadRecords(); };
$("#pn").onclick = () => { page++; loadRecords(); };

$("#r_csv").onclick = async () => {
  const rows = []; let from = 0;
  while (from < 20000) {
    const { data, error } = await applyFilters(sb.from("cases_v").select("*")).order("id").range(from, from + 999);
    if (error) return alert(error.message);
    rows.push(...data); if (data.length < 1000) break; from += 1000;
  }
  if (!rows.length) return alert("Nothing to export");
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(","), ...rows.map(r => keys.map(k => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  a.download = `transformers_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
};

/* ---------- add / edit form ---------- */
const GROUPS = [
  ["PR / location", [["pr_no", "PR No", "text"], ["pr_date", "PR date", "date"], ["workshop", "Workshop", "ws"], ["division", "Division", "text"], ["subdivision", "Subdivision", "text"], ["substation", "Substation", "text"], ["feeder", "Feeder", "text"], ["place_of_damage", "Place of damage", "text"], ["did_no", "DID no", "text"], ["capacity_kva", "Capacity kVA", "number"], ["date_of_damage", "Date of damage", "date"], ["complain_no", "Complaint no", "text"], ["complain_date", "Complaint date", "date"], ["je_name", "JE name", "text"], ["je_mobile", "JE mobile", "text"]]],
  ["Issue / replacement", [["issued_to_firm", "Issued to firm", "text"], ["issue_date", "Issue date", "date"], ["driver_name", "Driver", "text"], ["driver_mobile", "Driver mobile", "text"], ["replacement_date", "Replacement date", "date"]]],
  ["Damaged TX at workshop", [["tx_return_date", "TX return date", "date"], ["observation_dtc", "Observation during DTC", "text"], ["cause_of_damage", "Cause of damage", "text"], ["ht_protection", "HT protection", "text"], ["lt_protection", "LT protection", "text"], ["dtc_number", "DTC number", "text"], ["dtc_date", "DTC date", "date"]]],
  ["Repair", [["repair_firm", "Repair firm", "text"], ["repair_issue_date", "Issued to firm on", "date"], ["job_number", "Job number", "text"], ["repaired_date", "Repaired date", "date"], ["testing_date", "Testing date", "date"], ["kitty_date", "Inclusion in kitty", "date"]]],
  ["Re-issue", [["reissue_date", "Re-issue date", "date"], ["reissue_location", "DT location", "text"], ["reissue_feeder", "Feeder", "text"], ["reissue_substation", "Substation", "text"], ["reissue_division", "Division", "text"], ["remarks", "Remarks", "text"]]]
];
function openForm(row) {
  const isNew = !row, canEdit = profile.role !== "viewer";
  if (isNew && !canEdit) return;
  const dis = canEdit ? "" : "disabled";
  $("#dform").innerHTML = `<h2 style="margin:0">${isNew ? "New PR" : "PR " + esc(row.pr_no)} ${isNew ? "" : `<span class="pill">${esc(stageName(row.stage))}</span>`}</h2>` +
    GROUPS.map(([g, fs]) => `<div class="fg"><h3>${g}</h3>` + fs.map(([k, l, t]) => {
      const v = row?.[k] ?? (k === "workshop" && profile.workshop ? profile.workshop : "");
      const ro = (!isNew && k === "pr_no") ? "readonly" : "";
      const inp = t === "ws" ? `<select name="${k}" ${dis}>${["AZAMGARH", "MAU", "BALLIA"].map(w => `<option ${w === v ? "selected" : ""}>${w}</option>`).join("")}</select>`
        : `<input name="${k}" type="${t}" value="${esc(v)}" ${ro} ${dis}>`;
      return `<label>${l}${inp}</label>`;
    }).join("") + "</div>").join("") +
    `<div class="row" style="justify-content:flex-end;margin-top:14px"><span class="err" id="ferr"></span>
      <button class="btn sec" type="button" id="fclose">Close</button>${canEdit ? `<button class="btn" id="fsave" type="button">Save</button>` : ""}</div>`;
  $("#dlg").showModal(); $("#fclose").onclick = () => $("#dlg").close();
  $("#dform").onsubmit = e => e.preventDefault();
  const save = $("#fsave"); if (!save) return;
  save.onclick = async () => {
    const fd = new FormData($("#dform")), payload = {};
    for (const [, fs] of GROUPS) for (const [k, , t] of fs) {
      let v = (fd.get(k) ?? "").toString().trim(); if (v === "") v = null; else if (t === "number") v = +v;
      if (isNew || v !== (row[k] ?? null)) payload[k] = v;
    }
    if (isNew && (!payload.pr_no || !payload.workshop)) return $("#ferr").textContent = "PR No and Workshop are required";
    if (!isNew && !Object.keys(payload).length) return $("#dlg").close();
    save.disabled = true;
    const { error } = isNew ? await sb.from("transformer_cases").insert(payload)
                            : await sb.from("transformer_cases").update(payload).eq("id", row.id);
    save.disabled = false;
    if (error) return $("#ferr").textContent = error.message;
    $("#dlg").close(); loadRecords(); loadOverview();
  };
}
$("#r_new").onclick = () => openForm(null);

boot();
