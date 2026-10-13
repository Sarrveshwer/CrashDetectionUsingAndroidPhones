/* CrashDet — dashboard page */
(function () {
  const { $, esc, state: S } = CD;
  CD.mount("dashboard");

  let stats = { accidents: 0, ems: 0, freq: 0 };
  let filter = "all";
  const sparkHistory = { accidents: [], ems: [], freq: [] };
  const sparkCharts = {};

  const ICON_EMPTY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l1.6-5.4A3 3 0 0 1 8.5 8.5h7a3 3 0 0 1 2.9 2.1L20 16"/><path d="M3.5 16h17"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>';

  /* ---------- hero: most relevant incident ---------- */
  function renderHero() {
    const hero = $("#hero");
    const list = S.incidents;
    if (!S.serverUrl) {
      hero.className = "hero clear";
      hero.innerHTML = `<div><div class="eyebrow">Status</div><h2>Not connected</h2><div class="meta">This dashboard isn't linked to the CrashDet service yet. Ask your administrator to finish setup.</div></div>`;
      return;
    }
    if (!S.incidentsLoaded) { hero.className = "hero clear"; hero.innerHTML = `<div class="skeleton" style="width:100%;height:4.5rem"></div>`; return; }
    const pending = list.filter(i => CD.statusGroup(i.status) === "pending");
    const inc = pending[0] || list[0];
    if (!inc) {
      hero.className = "hero clear";
      hero.innerHTML = `<div><div class="eyebrow">All clear</div><h2>No incidents reported</h2><div class="meta">New crash reports from your edge nodes will appear here the moment they arrive.</div></div>`;
      return;
    }
    const isPending = CD.statusGroup(inc.status) === "pending";
    const sev = String(inc.severity);
    hero.className = "hero";
    hero.innerHTML = `
      <div class="hero-text">
        <div class="eyebrow">${isPending ? `Needs review${pending.length > 1 ? ` · ${pending.length} waiting` : ""}` : "Latest incident"}</div>
        <h2>${esc(CD.incidentTitle(inc))}</h2>
        <div class="meta">${esc(CD.locationText(inc.location))} · ${esc(inc.cameraName || inc.device_id)} · ${esc(CD.ago(inc.timestamp))}</div>
        <div class="pills">
          <span class="pill">${esc(CD.cap(inc.status))}</span>
          <span class="pill ${CD.isSevere(sev) ? "alert" : ""}">Severity: ${esc(CD.cap(sev))}</span>
        </div>
      </div>
      <div class="hero-actions">
        <button class="btn-light" id="heroReview" type="button">Review incident</button>
        ${/dispatch|respond|resolved/i.test(inc.status) ? "" : `<button class="sos-btn" id="heroDispatch" type="button">${CD.icons.warn} Dispatch EMS</button>`}
      </div>`;
    $("#heroReview").onclick = () => CD.showIncident(inc);
    const d = $("#heroDispatch"); if (d) d.onclick = () => { S.current = inc; if (isPending) CD.showIncident(inc); else CD.openEms(); };
  }

  /* ---------- incident list ---------- */
  function renderList() {
    const box = $("#incList");
    if (!S.serverUrl) { box.innerHTML = empty("Not connected", "Incident reports will show up here once the dashboard is linked to the CrashDet service."); return; }
    if (!S.incidentsLoaded) { box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>'; return; }
    const rows = S.incidents.filter(i => filter === "all" || CD.statusGroup(i.status) === filter);
    if (!rows.length) {
      box.innerHTML = S.incidents.length
        ? empty("Nothing here", "No incidents match this filter.")
        : empty("No incidents yet", "When an edge node detects a crash, the report appears here automatically.");
      return;
    }
    box.innerHTML = "";
    rows.slice(0, 40).forEach(inc => {
      const g = CD.statusGroup(inc.status);
      const b = document.createElement("button");
      b.type = "button"; b.className = "inc-row";
      b.innerHTML = `
        <span class="log-dot ${CD.isSevere(inc.severity) ? "crit" : "info"}"></span>
        <span class="inc-main">
          <div class="inc-title">${esc(CD.incidentTitle(inc))} · ${esc(CD.cap(inc.severity))}</div>
          <div class="inc-sub">${esc(inc.cameraName || inc.device_id)} · ${esc(CD.ago(inc.timestamp))}</div>
        </span>
        <span class="inc-status ${g}">${esc(CD.cap(inc.status))}</span>`;
      b.addEventListener("click", () => CD.showIncident(inc));
      box.appendChild(b);
    });
  }
  function empty(title, text) {
    return `<div class="empty"><div class="ico">${ICON_EMPTY}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  }

  $("#incFilters").addEventListener("click", e => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll("#incFilters .chip").forEach(c => c.setAttribute("aria-pressed", String(c === b)));
    renderList();
  });

  function renderResponses() {
    const box = $("#responseList");
    if (!box) return;
    const ledger = CD.responseLog.all();
    const byId = new Map(ledger.map(e => [String(e.incidentId), e]));
    const incidentRows = S.incidents
      .filter(i => !/reject|false/i.test(String(i.status)))
      .map(i => {
        const saved = byId.get(String(i.id)) || {};
        const status = /resolved/i.test(String(i.status)) ? "RESOLVED"
          : /respond/i.test(String(i.status)) ? "RESPONDING"
          : /dispatch/i.test(String(i.status)) ? "DISPATCHED"
          : /verified/i.test(String(i.status)) && !/unverified/i.test(String(i.status)) ? "CONFIRMED_AWAITING_DISPATCH"
          : saved.status || "AWAITING_REVIEW";
        return { ...saved, incidentId: i.id, cameraName: i.cameraName || saved.cameraName || i.device_id || "Unknown camera",
          incidentLocation: saved.incidentLocation || CD.locationText(i.location), severity: i.severity || saved.severity || "unknown",
          status: status === "AWAITING_REVIEW" && saved.status ? saved.status : status,
          unitName: i.unitName || i.unit_name || i.assignedUnitName || i.assigned_unit_name || saved.unitName || null,
          unitId: i.assignedUnit || i.assigned_unit || i.unitId || saved.unitId || null,
          timestamp: i.timestamp || saved.confirmedAt || i.createdAt || null };
      });
    const known = new Set(incidentRows.map(e => String(e.incidentId)));
    ledger.forEach(e => { if (!known.has(String(e.incidentId))) incidentRows.push(e); });
    incidentRows.sort((a,b) => new Date(b.updatedAt || b.timestamp || b.confirmedAt || 0) - new Date(a.updatedAt || a.timestamp || a.confirmedAt || 0));
    if (!incidentRows.length) {
      box.innerHTML = '<div class="empty-note">No incidents to track yet.</div>';
      return;
    }
    box.innerHTML = incidentRows.slice(0, 30).map(e => {
      const dispatched = ["DISPATCHED","RESPONDING","RESOLVED"].includes(String(e.status).toUpperCase());
      const unit = e.unitName || (e.unitId ? `Unit ${e.unitId}` : "No EMS assigned");
      const status = String(e.status || "AWAITING_REVIEW").replaceAll("_", " ");
      const simulation = e.simulated ? " · DEMO ONLY" : "";
      return `<article class="response-row">
        <div class="response-top"><strong>${esc(e.cameraName || "Unknown camera")}</strong><span class="response-status ${dispatched ? "assigned" : ""}">${esc(status)}</span></div>
        <div class="response-id">Incident ${esc(e.incidentId)}</div>
        <div class="response-unit"><span>EMS unit</span><strong>${esc(unit)}${esc(simulation)}</strong></div>
        <div class="response-meta">${esc(e.incidentLocation || "Location not provided")} · ${esc(CD.cap(e.severity || "unknown"))}</div>
        ${e.dispatchRef ? `<div class="response-meta">Dispatch reference: ${esc(e.dispatchRef)}</div>` : ""}
      </article>`;
    }).join("");
  }

  CD.on("incidents", () => { renderHero(); renderList(); renderResponses(); });
  CD.on("offline", () => { renderHero(); renderList(); renderResponses(); });
  CD.on("responses", renderResponses);

  /* ---------- KPIs ---------- */
  function renderKpis() {
    $("#kpiAccidents").textContent = Number(stats.accidents || 0);
    $("#kpiEms").textContent = Number(stats.ems || 0);
    $("#kpiFreq").textContent = Number(stats.freq || 0).toFixed(1);
  }
  renderKpis();
  renderResponses();

  /* ---------- charts load after first paint so a slow CDN never blocks the page ---------- */
  const CHART_URL = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js";
  let chartsReady = false, trendChart = null, pendingTrend = null;

  function spark(id, color) {
    sparkCharts[id] = new Chart(document.getElementById(id), {
      type: "line",
      data: { labels: [0], datasets: [{ data: [0], borderColor: color, borderWidth: 2, tension: .4, pointRadius: 0, fill: true, backgroundColor: color + "22" }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, elements: { line: { borderJoinStyle: "round" } } }
    });
  }

  function initCharts() {
    Chart.defaults.font.family = "Onest";
    Chart.defaults.color = "#717784";
    spark("sparkAccidents", "#2563c9"); spark("sparkEms", "#0b6e97"); spark("sparkFreq", "#ff5a36");
    trendChart = new Chart($("#trendChart"), {
      type: "bar",
      data: { labels: [], datasets: [
        { label: "Accidents occurred", data: [], backgroundColor: "#2563c9", borderRadius: 6, barPercentage: 0.55 },
        { label: "EMS deployed", data: [], backgroundColor: "#0b6e97", borderRadius: 6, barPercentage: 0.55 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle" } } }, scales: { x: { grid: { display: false } }, y: { grid: { color: "#e6e8ec" }, beginAtZero: true, ticks: { precision: 0 } } } }
    });
    chartsReady = true;
    if (pendingTrend) renderTrend(pendingTrend);
    updateSpark();
  }

  function updateSpark(record) {
    if (record) {
      Object.entries({ accidents: stats.accidents, ems: stats.ems, freq: stats.freq }).forEach(([k, v]) => {
        const h = sparkHistory[k];
        if (!h.length || h[h.length - 1] !== v) h.push(v);
        if (h.length > 10) h.shift();
      });
    }
    if (!chartsReady) return;
    [["sparkAccidents", "accidents"], ["sparkEms", "ems"], ["sparkFreq", "freq"]].forEach(([id, k]) => {
      const c = sparkCharts[id];
      c.data.labels = sparkHistory[k].map((_, i) => i + 1);
      c.data.datasets[0].data = sparkHistory[k];
      c.update("none");
    });
  }

  function renderTrend(trend) {
    pendingTrend = trend;
    if (!chartsReady) return;
    trendChart.data.labels = trend.map(t => t.label || t.hour || t.time || "");
    trendChart.data.datasets[0].data = trend.map(t => Number(t.accidents ?? t.incidents ?? 0));
    trendChart.data.datasets[1].data = trend.map(t => Number(t.ems ?? t.dispatches ?? t.dispatched ?? 0));
    trendChart.update();
  }

  CD.loadScript(CHART_URL).then(initCharts).catch(() => {
    $(".chart-wrap:not(.spark)").innerHTML = '<div class="empty-note">The chart couldn\'t load. Check your connection and refresh.</div>';
  });

  /* ---------- heatmap ---------- */
  const heatColors = ["#f1f5fb", "#dbeafe", "#a9ccfb", "#6da5f2", "#3478d4", "#174a91"];
  const colorFor = (v, max) => {
    if (v <= 0 || max <= 0) return heatColors[0];
    return heatColors[Math.min(heatColors.length - 1, Math.max(1, Math.ceil((v / max) * (heatColors.length - 1))))];
  };
  function renderHeatmap(data, falsePositiveData = new Array(24).fill(0)) {
    const grid = $("#heatGrid");
    if (!grid) return;
    const values = Array.from({ length: 24 }, (_, h) => Math.max(0, Number(data?.[h]) || 0));
    const max = Math.max(0, ...values);
    grid.innerHTML = "";
    values.forEach((v, h) => {
      const c = document.createElement("div");
      const falsePositives = Math.max(0, Number(falsePositiveData?.[h]) || 0);
      const total = v + falsePositives;
      const label = `${String(h).padStart(2, "0")}:00 · ${total} total reports · ${v} valid/active · ${falsePositives} false positive${falsePositives === 1 ? "" : "s"}`;
      c.className = "heat-cell" + (falsePositives > 0 ? " has-false-positive" : "");
      c.style.backgroundColor = colorFor(v, max);
      c.style.borderColor = falsePositives > 0 ? "#dc2626" : (v > 0 ? "rgba(23,74,145,.22)" : "#e2e8f0");
      c.setAttribute("role", "img");
      c.setAttribute("aria-label", label);
      c.setAttribute("data-label", label);
      c.title = label;
      c.dataset.value = String(v);
      c.dataset.falsePositives = String(falsePositives);
      grid.appendChild(c);
    });
    const swatches = $("#heatSwatches");
    if (swatches && !swatches.children.length) {
      heatColors.forEach((color, i) => {
        const swatch = document.createElement("div");
        swatch.className = "sw";
        swatch.style.backgroundColor = color;
        swatch.title = ["No reports", "Very low", "Low", "Moderate", "High", "Peak"][i];
        swatches.appendChild(swatch);
      });
    }
  }
  renderHeatmap(new Array(24).fill(0));

  /* ---------- stats from the backend ---------- */
  // Server numbers (base) + accidents confirmed on this device (CD.accidentLog) = what the dashboard shows.
  let base = { accidents: 0, ems: 0, freq: 0, heat: new Array(24).fill(0), trend: null };

  function localStats() {
    const now = new Date(), all = CD.accidentLog.all();
    const acc = all.filter(e => e.kind === "accident"), ems = all.filter(e => e.kind === "ems");
    const isToday = e => new Date(e.t).toDateString() === now.toDateString();
    const heat = new Array(24).fill(0);
    acc.filter(isToday).forEach(e => heat[new Date(e.t).getHours()]++);
    const trend = Array.from({ length: 12 }, (_, k) => {
      const end = new Date(now); end.setMinutes(59, 59, 999); end.setHours(now.getHours() - (11 - k));
      const start = new Date(end.getTime() - 3599999);
      const inBucket = list => list.filter(e => { const x = new Date(e.t).getTime(); return x >= start && x <= end; }).length;
      return { label: String(start.getHours()).padStart(2, "0") + ":00", accidents: inBucket(acc), ems: inBucket(ems) };
    });
    return { accidents: acc.filter(isToday).length, ems: ems.filter(isToday).length, freq: acc.filter(e => Date.now() - new Date(e.t) < 3600000).length, heat, trend };
  }

  function paint(t) {
    const L = localStats();
    stats.accidents = base.accidents + L.accidents;
    stats.ems = base.ems + L.ems;
    stats.freq = base.freq + L.freq;
    renderKpis();
    const incidentHeat = new Array(24).fill(0);
    const falsePositiveHeat = new Array(24).fill(0);
    const today = new Date();
    const seenIncidentIds = new Set();
    (S.incidents || []).forEach(incident => {
      const stamp = incident.timestamp || incident.createdAt || incident.created_at;
      const date = new Date(stamp);
      if (Number.isNaN(date.getTime()) || date.toDateString() !== today.toDateString()) return;
      const id = String(incident.id || incident._id || "");
      if (id && seenIncidentIds.has(id)) return;
      if (id) seenIncidentIds.add(id);
      const status = String(incident.status || incident.state || "");
      if (/reject|false.?positive|invalid|not.?an.?accident/i.test(status)) falsePositiveHeat[date.getHours()] += 1;
      else incidentHeat[date.getHours()] += 1;
    });
    const heat = incidentHeat.some(Boolean) || falsePositiveHeat.some(Boolean)
      ? incidentHeat.map((v, h) => v + L.heat[h])
      : base.heat.map((v, h) => v + L.heat[h]);
    renderHeatmap(heat, falsePositiveHeat);
    let trend = L.trend;
    if (base.trend && base.trend.length) {
      trend = base.trend.map(x => ({ label: x.label || x.hour || x.time || "", accidents: Number(x.accidents ?? x.incidents ?? 0), ems: Number(x.ems ?? x.dispatches ?? x.dispatched ?? 0) }));
      if (trend.length === L.trend.length) trend = trend.map((x, i) => ({ ...x, accidents: x.accidents + L.trend[i].accidents, ems: x.ems + L.trend[i].ems }));
      else { const last = trend[trend.length - 1]; last.accidents += L.trend.reduce((a, b) => a + b.accidents, 0); last.ems += L.trend.reduce((a, b) => a + b.ems, 0); }
    }
    renderTrend(trend);
    updateSpark(true);
    if (t) $("#updatedAt").textContent = `Updated ${new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  function applyStats(d, t) {
    base.accidents = Number(d.accidents_today ?? d.incidents_today ?? d.today_accidents ?? d.todayIncidents ?? d.accidents ?? 0);
    base.ems = Number(d.ems_deployed_today ?? d.dispatched_today ?? d.dispatches_today ?? d.ems ?? d.incidentsByStatus?.DISPATCHED ?? d.incidentCounts?.DISPATCHED ?? 0);
    base.freq = Number(d.frequency_per_hour ?? d.accidents_per_hour ?? d.incidents_per_hour ?? d.frequencyPerHour ?? 0);
    const heat = d.heat_buckets ?? d.heatmap ?? d.hourly ?? null;
    if (Array.isArray(heat)) base.heat = Array.from({ length: 24 }, (_, h) => { const v = heat[h]; return typeof v === "object" ? Number(v?.count ?? v?.value ?? 0) : Number(v ?? 0); });
    else if (heat && typeof heat === "object") base.heat = Array.from({ length: 24 }, (_, h) => Number(heat[h] ?? heat[String(h)] ?? 0));
    base.trend = Array.isArray(d.trend) ? d.trend : Array.isArray(d.hourlyTrend) ? d.hourlyTrend : null;
    paint(t);
  }

  let statsFlight = null;
  function refreshStats() {
    if (!S.serverUrl) return Promise.resolve();
    if (statsFlight) return statsFlight;
    statsFlight = (async () => {
      try {
        const r = await CD.api("/api/dashboard/stats");
        if (!r.ok) { const e = new Error(`Stats request failed (${r.status})`); e.status = r.status; throw e; }
        const d = await r.json();
        CD.cache.set("stats", d);
        applyStats(d, Date.now());
      } catch (err) {
        CD.log(`Could not refresh dashboard statistics · ${err.message}`, "crit");
        if (err.status !== 401 && err.status !== 403 && !CD.quiet()) CD.toast("Couldn't refresh the numbers. Showing the last values.", "crit");
      }
    })().finally(() => { statsFlight = null; });
    return statsFlight;
  }

  CD.on("sync", refreshStats);
  CD.on("poll", refreshStats);
  CD.on("realtime", ({ name }) => { if (name.startsWith("incident") || name === "dashboard:update") refreshStats(); });
  CD.on("dispatched", () => { refreshStats(); paint(); });
  CD.on("responses", renderResponses);
  CD.on("confirmed", () => { refreshStats(); paint(); }); // a confirmed accident shows up on the graph straight away

  // keep "x min ago" fresh
  setInterval(() => {
    if (!S.incidentsLoaded) return;
    const list = $("#incList"), top = list.scrollTop;
    renderHero(); renderList(); list.scrollTop = top;
  }, 60000);

  renderHero(); renderList();
  const cachedStats = S.serverUrl && CD.cache.get("stats");
  if (cachedStats) applyStats(cachedStats.d, cachedStats.t); else paint();
  CD.start();
})();
