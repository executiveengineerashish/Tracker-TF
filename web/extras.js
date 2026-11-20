/* Phase 1: quick PR search + emergency list (uses globals from app.js) */
const stat = r => r.testing_date ? "Tested / ready" : r.repaired_date ? "Repaired" : r.oven_date ? "In oven" : r.assembly_date ? "In assembly" : r.dtc_date ? "DTC done"
  : r.tx_return_date ? "Returned – DTC pending" : r.replacement_date ? "Replaced – return pending" : r.issue_date ? "Issued – replacement pending" : "Pending for issue";
const tel = m => m ? `<a href="tel:${esc(m)}">${esc(m)}</a>` : "–";

async function quickSearch(t) {
  t = t.replace(/[,()%*]/g, " ").trim(); if (!t) return;
  const f = ["pr_no", "complain_no", "did_no", "place_of_damage", "je_name", "driver_name", "feeder", "substation", "issued_to_firm"].map(c => `${c}.ilike.%${t}%`).join(",");
  const { data, error } = await sb.from("transformer_cases").select("*").or(f).order("pr_date", { ascending: false }).limit(10);
  const d = $("#dlg"), form = $("#dform");
  form.innerHTML = `<h2>Search: ${esc(t)}</h2>` + (error ? `<p class="err">${esc(error.message)}</p>` : !data.length ? "<p>No match.</p>" :
    data.map(r => `<div class="card"><b>PR ${esc(r.pr_no)}</b> · ${esc(r.capacity_kva)} kVA · ${esc(r.workshop)}<br>
    <span class="pill">${stat(r)}</span><br>${esc(r.place_of_damage)} · ${esc(r.feeder)}<br>
    JE: ${esc(r.je_name)} ${tel(r.je_mobile)}<br>Driver: ${esc(r.driver_name)} ${tel(r.driver_mobile)} · Firm: ${esc(r.issued_to_firm) || "–"}</div>`).join("")) +
    `<button class="btn sec" value="close">Close</button>`;
  d.showModal();
}

async function loadEmerg() {
  const { data } = await sb.from("emergencies").select("*").eq("status", "OPEN").order("created_at", { ascending: false });
  const b = $("#emgbar"); window._emg = data || [];
  b.classList.toggle("hide", !window._emg.length);
  b.innerHTML = window._emg.map(e => `🚨 <b>EMERGENCY</b> ${esc(e.village)} · ${esc(e.ref_by)} · Complaint ${esc(e.complain_no)} · ${tel(e.mobile)} ${esc(e.details)}`).join("<br>");
}

function emergDlg() {
  const edit = profile.role !== "viewer", form = $("#dform");
  form.innerHTML = `<h2>🚨 Emergency</h2>` + (edit ? `<div class="row"><label>Referred by<input id="e_ref"></label><label>Complaint no<input id="e_cn"></label>
    <label>Village<input id="e_vil"></label><label>Mobile<input id="e_mob"></label><label>Details<input id="e_det"></label>
    <button class="btn" id="e_add" type="button">Add</button></div>` : "") +
    (window._emg.map(e => `<div class="card">${esc(e.village)} · ${esc(e.ref_by)} · ${esc(e.complain_no)} · ${tel(e.mobile)}<br>${esc(e.details)}
      ${edit ? `<button class="btn sec" type="button" data-close="${e.id}">Mark replaced</button>` : ""}</div>`).join("") || "<p>No open emergencies.</p>") +
    `<button class="btn sec" value="close">Close</button>`;
  $("#dlg").showModal();
  $("#e_add")?.addEventListener("click", async () => {
    await sb.from("emergencies").insert({ ref_by: $("#e_ref").value, complain_no: $("#e_cn").value, village: $("#e_vil").value, mobile: $("#e_mob").value, details: $("#e_det").value, workshop: profile.workshop, created_by: profile.display_name });
    await loadEmerg(); emergDlg();
  });
  form.querySelectorAll("[data-close]").forEach(x => x.onclick = async () => {
    await sb.from("emergencies").update({ status: "CLOSED", closed_at: new Date().toISOString() }).eq("id", x.dataset.close);
    await loadEmerg(); emergDlg();
  });
}

$("#qs").addEventListener("keydown", e => { if (e.key === "Enter") quickSearch(e.target.value); });
$("#emgbtn").onclick = emergDlg;
sb.auth.getSession().then(({ data: { session } }) => session && setTimeout(loadEmerg, 800));
setInterval(() => profile && loadEmerg(), 60000);
