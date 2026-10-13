/* CrashDet — shared core: connection, realtime, incident dialog, EMS dispatch, chrome */
(function () {
  const CD = (window.CD = {});
  const $ = (CD.$ = (s, r = document) => r.querySelector(s));

  CD.esc = v => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  CD.state = {
    serverUrl: localStorage.getItem("crashdet_server_url") || "",
    jwt: localStorage.getItem("crashdet_jwt") || "",
    socket: null,
    incidents: [],
    incidentsLoaded: false,
    nodes: [],
    nodesLoaded: false,
    nodesError: "",
    current: null,
    units: [],
    link: "offline"
  };
  const S = CD.state;

  /* ---------- tiny cache so pages paint instantly, then refresh ---------- */
  CD.cache = {
    get(k) { try { const v = JSON.parse(localStorage.getItem("crashdet_cache_" + k)); return v && v.d !== undefined ? v : null; } catch { return null; } },
    set(k, d) { try { localStorage.setItem("crashdet_cache_" + k, JSON.stringify({ t: Date.now(), d })); } catch {} },
    clear() { try { Object.keys(localStorage).filter(k => k.startsWith("crashdet_cache_")).forEach(k => localStorage.removeItem(k)); } catch {} }
  };

  /* ---------- load third-party scripts on demand, never blocking first paint ---------- */
  const scripts = {};
  CD.loadScript = src => scripts[src] || (scripts[src] = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true; s.onload = res;
    s.onerror = () => { delete scripts[src]; rej(new Error("Script failed to load")); };
    document.head.appendChild(s);
  }));
  CD.loadSocketLib = () => (typeof window.io === "function" ? Promise.resolve() : CD.loadScript("./socket.io.min.js"))
    .then(() => { if (typeof window.io !== "function") throw new Error("Socket.IO unavailable"); });
  const quiet = () => S.link === "connecting" || S.link === "offline";
  CD.quiet = quiet;
  const authErr = e => e && (e.status === 401 || e.status === 403);
  const httpErr = (r, what) => { const e = new Error(`${what} (${r.status})`); e.status = r.status; return e; };

  /* ---------- tiny event bus ---------- */
  const listeners = {};
  CD.on = (e, fn) => (listeners[e] = listeners[e] || []).push(fn);
  CD.emit = (e, d) => (listeners[e] || []).forEach(fn => { try { fn(d); } catch (err) { console.error(err); } });

  /* ---------- diagnostics (visible only on the developer page) ---------- */
  CD.log = (text, type = "info") => {
    try {
      const arr = JSON.parse(localStorage.getItem("crashdet_devlog") || "[]");
      arr.unshift({ text, type, t: new Date().toISOString() });
      localStorage.setItem("crashdet_devlog", JSON.stringify(arr.slice(0, 100)));
    } catch {}
    console[type === "crit" ? "warn" : "log"]("[CrashDet]", text);
  };

  /* ---------- toasts ---------- */
  CD.toast = (msg, type = "info") => {
    let box = $("#toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 4200);
  };

  /* ---------- helpers ---------- */
  CD.ago = ts => {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 604800) return `${Math.round(s / 86400)} d ago`;
    return d.toLocaleDateString();
  };
  CD.cap = s => { s = String(s ?? "").replaceAll("_", " ").toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
  CD.isSevere = s => /severe|critical|high/i.test(String(s));
  CD.statusGroup = s => /pending|unverified|new/i.test(s) ? "pending" : /dispatch|respond|verified/i.test(s) ? "active" : /resolved|reject|closed/i.test(s) ? "done" : "other";
  CD.coords = loc => {
    if (!loc) return null;
    if (typeof loc === "object") {
      const lat = loc.latitude ?? loc.lat, lng = loc.longitude ?? loc.lng ?? loc.lon;
      if (lat == null || lng == null) return null;
      return { lat: Number(lat), lng: Number(lng), label: loc.label || loc.name || loc.address || "" };
    }
    const m = String(loc).match(/(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)/);
    return m ? { lat: Number(m[1]), lng: Number(m[3]), label: "" } : null;
  };
  CD.locationText = loc => {
    if (!loc) return "Location not provided";
    const c = CD.coords(loc);
    if (c) return `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}${c.label ? " · " + c.label : ""}`;
    return typeof loc === "string" ? loc : Object.values(loc).join(", ");
  };
  CD.mediaUrl = u => !u ? "" : /^https?:\/\//i.test(u) ? u : `${base()}/${String(u).replace(/^\/+/, "")}`;

  function base() { return S.serverUrl.replace(/\/+$/, ""); }
  CD.base = base;

  CD.api = (path, opts = {}) => {
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (opts.auth !== false && S.jwt) headers["Authorization"] = `Bearer ${S.jwt}`;
    const o = Object.assign({}, opts, { headers });
    delete o.auth;
    return fetch(base() + path, o);
  };

  CD.normalize = item => {
    if (!item || typeof item !== "object") return null;
    const i = item.incident || item.data || item;
    return {
      ...i,
      id: i.id || i._id || i.incident_id || null,
      device_id: i.device_id || i.deviceId || i.edgeDeviceId || i.node_id || "unknown",
      severity: i.severity || i.impact_level || i.confidence_level || "unknown",
      timestamp: i.timestamp || i.created_at || i.createdAt || new Date().toISOString(),
      location: i.location || i.coordinates || null,
      videoUrl: i.videoUrl || i.video_url || null,
      snapshotImage: i.snapshotImage || i.snapshot_image || null,
      status: i.status || i.state || "PENDING_VERIFICATION"
    };
  };
  CD.incidentTitle = () => "Crash report"; // incident type is intentionally hidden

  /* ---------- confirmed-accident log (feeds the dashboard graph when the server doesn't) ---------- */
  CD.accidentLog = {
    key: "crashdet_accident_log",
    all() {
      try { const cut = Date.now() - 24 * 3600e3; return JSON.parse(localStorage.getItem(this.key) || "[]").filter(e => new Date(e.t).getTime() > cut); }
      catch { return []; }
    },
    add(id, kind) { // kind: "accident" | "ems"
      const a = this.all();
      if (a.some(e => e.id === id && e.kind === kind)) return false;
      a.push({ id, kind, t: new Date().toISOString() });
      try { localStorage.setItem(this.key, JSON.stringify(a)); } catch {}
      return true;
    },
    remove(id, kind) {
      try { localStorage.setItem(this.key, JSON.stringify(this.all().filter(e => !(e.id === id && e.kind === kind)))); } catch {}
    },
    clear() { try { localStorage.removeItem(this.key); } catch {} }
  };

  /* ---------- EMS-to-incident response ledger ---------- */
  CD.responseLog = {
    key: "crashdet_response_log",
    all() {
      try { return JSON.parse(localStorage.getItem(this.key) || "[]").filter(e => e && e.incidentId); }
      catch { return []; }
    },
    upsert(entry) {
      const items = this.all();
      const key = String(entry.incidentId);
      const idx = items.findIndex(e => String(e.incidentId) === key);
      const next = { ...(idx >= 0 ? items[idx] : {}), ...entry, incidentId: key, updatedAt: new Date().toISOString() };
      if (idx >= 0) items[idx] = next; else items.unshift(next);
      try { localStorage.setItem(this.key, JSON.stringify(items.slice(0, 500))); } catch {}
      CD.emit("responses", this.all());
      return next;
    }
  };

  /* ---------- connection status pill ---------- */
  CD.setLink = (state, message = "") => {
    S.link = state;
    S.linkMessage = message || "";
    const el = $("#linkStatus");
    if (!el) return;
    const dot = (c) => c ? `<span class="dot" style="background:${c};box-shadow:none;animation:none"></span>` : '<span class="dot"></span>';
    el.innerHTML =
      state === "live" ? `${dot()} Live` :
      state === "connecting" ? `${dot("#f59e0b")} Connecting…` :
      state === "auth" ? `${dot("#f59e0b")} Connected · auto-refresh` :
      `${dot("#d7dae1")} Offline`;
    el.title = CD.page === "dev" ? (message || "") : "";
    CD.emit("link", state);
  };

  /* ---------- connect ---------- */
  let seenOnce = false;
  let seenEvents = new Set();

  CD.connect = async (url, token) => {
    if (S.socket) { S.socket.removeAllListeners(); S.socket.disconnect(); S.socket = null; }
    const next = (url || "").trim().replace(/\/+$/, "").replace(/\/api$/i, "");
    if (next !== S.serverUrl) CD.cache.clear();
    S.serverUrl = next;
    S.jwt = (token || "").trim();
    localStorage.setItem("crashdet_server_url", S.serverUrl);
    localStorage.setItem("crashdet_jwt", S.jwt);
    seenOnce = false;

    if (!S.serverUrl) { CD.setLink("offline"); CD.emit("offline"); return false; }
    CD.setLink("connecting");
    CD.loadSocketLib().catch(() => {});      // warm the realtime library while data loads
    const authCheck = CD.api("/api/auth/me"); // runs in parallel with the data requests
    CD.emit("sync");                          // data requests start immediately
    try {
      const r = await authCheck;
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.message || b.error || `Authentication failed (${r.status})`);
      }
      CD.setLink("auth");
    } catch (err) {
      CD.setLink("offline", err.message);
      CD.log(`Backend authentication failed · ${err.message}`, "crit");
      CD.toast("Can't reach the CrashDet service. Check with your administrator.", "crit");
      CD.emit("offline", err);
      return false;
    }
    openSocket();
    return true;
  };

  // Requests of the same kind are coalesced: if one is running, at most one more follows.
  let incFlight = null, incQueued = false;
  let incidentBaselineReady = false;
  let autoPopupIncidentId = null;
  CD.loadIncidents = () => {
    if (!S.serverUrl) return Promise.resolve();
    if (incFlight) { incQueued = true; return incFlight; }
    incFlight = (async () => {
      try {
        const r = await CD.api("/api/incidents/");
        if (!r.ok) throw httpErr(r, "Incident request failed");
        const d = await r.json();
        const list = Array.isArray(d) ? d : Array.isArray(d.incidents) ? d.incidents : Array.isArray(d.data) ? d.data : Array.isArray(d.results) ? d.results : Array.isArray(d.data?.incidents) ? d.data.incidents : [];
        const previousIds = new Set(S.incidents.map(i => String(i.id || "")));
        const nextIncidents = list.map(CD.normalize).filter(Boolean);
        if (incidentBaselineReady) {
          const freshIncident = nextIncidents.find(i =>
            i.id && !previousIds.has(String(i.id)) && CD.statusGroup(i.status) === "pending"
          );
          if (freshIncident && String(freshIncident.id) !== autoPopupIncidentId) {
            autoPopupIncidentId = String(freshIncident.id);
            CD.toast("New crash report received", "crit");
            CD.showIncident(freshIncident);
          }
        }
        S.incidents = nextIncidents;
        incidentBaselineReady = true;
        CD.cache.set("incidents", S.incidents.slice(0, 40));
        const fresh = S.current?.id && S.incidents.find(i => i.id === S.current.id);
        S.current = fresh || S.incidents[0] || null;
      } catch (err) {
        CD.log(`Could not load incidents · ${err.message}`, "crit");
        if (!authErr(err) && !quiet()) CD.toast("Couldn't load incidents. Retrying on the next update.", "crit");
      }
      S.incidentsLoaded = true;
      CD.emit("incidents", S.incidents);
    })().finally(() => { incFlight = null; if (incQueued) { incQueued = false; CD.loadIncidents(); } });
    return incFlight;
  };

  let nodeFlight = null;
  CD.loadNodes = () => {
    if (!S.serverUrl) return Promise.resolve();
    if (nodeFlight) return nodeFlight;
    nodeFlight = (async () => {
      try {
        const r = await CD.api("/api/devices/");
        if (!r.ok) throw httpErr(r, "Device request failed");
        const b = await r.json();
        S.nodes = Array.isArray(b) ? b : Array.isArray(b.devices) ? b.devices : Array.isArray(b.data) ? b.data : Array.isArray(b.results) ? b.results : [];
        S.nodesError = "";
        CD.cache.set("nodes", S.nodes.slice(0, 200));
      } catch (err) {
        S.nodesError = S.nodes.length ? "" : err.message;
        CD.log(`Could not load edge nodes · ${err.message}`, "crit");
      }
      S.nodesLoaded = true;
      const tab = $("#nodeTabCount"); if (tab) tab.textContent = S.nodes.length;
      CD.emit("nodes", S.nodes);
    })().finally(() => { nodeFlight = null; });
    return nodeFlight;
  };

  // Units are only needed when the dispatch form opens, so they load on demand.
  CD.loadUnits = async () => {
    const sel = $("#emsUnit");
    if (CD.EMS_DEMO) {
      S.units = CD.emsDemoUnits.filter(u => u.status === "AVAILABLE");
      if (sel) {
        sel.innerHTML = '<option value="">Select an available unit</option>';
        S.units.forEach(u => { const o = document.createElement("option"); o.value = u.id; o.textContent = `${u.unitName} · ${CD.cap(u.unitType)}`; sel.appendChild(o); });
        if (!S.units.length) sel.innerHTML = '<option value="">No units available right now</option>';
      }
      return;
    }
    if (!S.serverUrl) return;
    try {
      const r = await CD.api("/api/units/");
      if (!r.ok) throw httpErr(r, "Unit request failed");
      const b = await r.json();
      const units = Array.isArray(b) ? b : (b.units || b.data || []);
      S.units = units.filter(u => String(u.status || "AVAILABLE").toUpperCase() === "AVAILABLE");
      if (!sel) return;
      sel.innerHTML = '<option value="">Select an available unit</option>';
      S.units.forEach(u => {
        const o = document.createElement("option");
        o.value = u._id || u.id || u.unitId;
        o.textContent = `${u.unitName || u.name || u.unitId || "Emergency unit"} · ${CD.cap(u.unitType || u.type || "unit")}`;
        sel.appendChild(o);
      });
      if (!S.units.length) sel.innerHTML = '<option value="">No units available right now</option>';
    } catch (err) {
      if (sel) sel.innerHTML = '<option value="">Could not load units</option>';
      CD.log(`Could not load emergency units · ${err.message}`, "crit");
    }
  };

  const EVENTS = ["incident:new", "incident:update", "incident:dispatched", "incident:responding", "incident:resolved", "device:registered", "device:online", "device:offline", "device:update", "dashboard:update"];
  async function openSocket() {
    try { await CD.loadSocketLib(); }
    catch {
      CD.setLink("auth", "Socket.IO client library failed to load (check internet / CDN access)");
      CD.log("Socket.IO client library failed to load", "crit");
      return;
    }
    if (!S.serverUrl || S.link === "offline") return;
    const sock = (S.socket = io(S.serverUrl, { transports: ["polling", "websocket"], timeout: 6000, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 10000, auth: S.jwt ? { token: S.jwt } : {} }));
    sock.on("connect", () => {
      CD.setLink("live");
      CD.log("Real-time connection established");
      if (seenOnce) CD.emit("sync"); // recover anything missed while offline
      seenOnce = true;
      sock.emit("join:admin");
    });
    sock.on("disconnect", reason => CD.setLink("auth", `Disconnected: ${reason}`));
    sock.on("connect_error", err => { CD.setLink("auth", err.message); CD.log(`Real-time connection error · ${err.message}`, "crit"); });
    EVENTS.forEach(name => sock.on(name, payload => onRealtime(name, payload)));
  }

  function onRealtime(name, payload) {
    if (name.startsWith("device:") || name === "dashboard:update") { CD.log(`${name} received`); if (name.startsWith("device:") && CD.page === "nodes") CD.loadNodes(); CD.emit("realtime", { name, payload }); return; }
    const inc = CD.normalize(payload);
    if (!inc || typeof payload !== "object") { CD.loadIncidents(); CD.emit("realtime", { name, payload }); return; }
    const key = `${name}:${inc.id || JSON.stringify(payload).slice(0, 160)}:${inc.status}`;
    if (seenEvents.has(key)) return;
    seenEvents.add(key);
    if (seenEvents.size > 500) seenEvents = new Set(Array.from(seenEvents).slice(-250));
    CD.log(`Live ${name} · ${inc.device_id} · ${inc.status}`, CD.isSevere(inc.severity) ? "crit" : "info");

    S.current = inc;
    const existingResponse = CD.responseLog.all().find(e => String(e.incidentId) === String(inc.id)) || {};
    if (name === "incident:dispatched") {
      CD.responseLog.upsert({
        ...existingResponse, incidentId: inc.id, status: "DISPATCHED",
        unitId: inc.assignedUnit || inc.assigned_unit || inc.unitId || existingResponse.unitId || null,
        unitName: inc.unitName || inc.unit_name || inc.assignedUnitName || inc.assigned_unit_name || existingResponse.unitName || null,
        dispatchedAt: existingResponse.dispatchedAt || new Date().toISOString()
      });
      CD.toast("EMS dispatch recorded", "ok");
    } else if (name === "incident:responding") {
      CD.responseLog.upsert({
        ...existingResponse, incidentId: inc.id, status: "RESPONDING",
        unitId: inc.assignedUnit || inc.assigned_unit || inc.unitId || existingResponse.unitId || null,
        unitName: inc.unitName || inc.unit_name || inc.assignedUnitName || inc.assigned_unit_name || existingResponse.unitName || null,
        respondingAt: new Date().toISOString()
      });
      CD.toast("EMS response started", "ok");
    } else if (name === "incident:resolved") {
      CD.responseLog.upsert({ ...existingResponse, incidentId: inc.id, status: "RESOLVED", resolvedAt: new Date().toISOString() });
      CD.toast("Incident resolved", "ok");
    }
    if (name === "incident:new") {
      if (String(inc.id || "") !== autoPopupIncidentId) {
        autoPopupIncidentId = String(inc.id || "");
        CD.toast("New crash report received", "crit");
        CD.showIncident(inc);
      }
    }
    CD.loadIncidents();
    CD.emit("realtime", { name, payload: inc });
  }

  /* ---------- chrome (header, tabs, dialogs) ---------- */
  const ICON = {
    car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l1.6-5.4A3 3 0 0 1 8.5 8.5h7a3 3 0 0 1 2.9 2.1L20 16"/><path d="M3.5 16h17"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01M4.4 19h15.2c1.4 0 2.3-1.5 1.6-2.7L13.6 4.6c-.7-1.2-2.5-1.2-3.2 0L2.8 16.3C2.1 17.5 3 19 4.4 19z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'
  };
  CD.icons = ICON;

  CD.mount = (active) => {
    CD.page = active;
    const chrome = $("#chrome");
    const dev = active === "dev";
    chrome.innerHTML = `
      <header class="dash">
        <a class="brand" href="index.html" id="brandMark" aria-label="CrashDet Control home">${ICON.car}<span>CrashDet Control</span></a>
        <div class="hdr-right">
          <span class="status-pill" id="linkStatus"><span class="dot" style="background:#d7dae1;box-shadow:none;animation:none"></span> Offline</span>
          <button class="sos-btn" id="openEms" type="button">${ICON.warn} Contact EMS</button>
        </div>
      </header>
      <nav class="tabbar" aria-label="Sections">
        ${dev
          ? `<a class="tab-btn" href="index.html">← Back to dashboard</a><a class="tab-btn" href="dev.html" aria-current="page">Developer tools</a>`
          : `<a class="tab-btn" href="index.html" ${active === "dashboard" ? 'aria-current="page"' : ""}>Dashboard</a>
             <a class="tab-btn" href="nodes.html" ${active === "nodes" ? 'aria-current="page"' : ""}>Edge nodes <span class="count" id="nodeTabCount">0</span></a>`}
      </nav>`;

    document.body.insertAdjacentHTML("beforeend", `
      <div id="incident-modal" aria-hidden="true">
        <div class="incident-backdrop" id="incidentModalBackdrop"></div>
        <section class="incident-dialog" role="dialog" aria-modal="true" aria-labelledby="incidentModalTitle">
          <header class="incident-dialog-head">
            <div><div class="eyebrow">Incident review</div><h2 id="incidentModalTitle">Crash report</h2><p id="incidentModalId"></p></div>
            <button class="incident-close" id="closeIncidentModal" type="button" aria-label="Close incident details">×</button>
          </header>
          <div class="incident-dialog-body">
            <div class="incident-evidence">
              <div class="incident-video-frame" id="incidentVideoFrame"></div>
              <div class="incident-evidence-caption"><span id="incidentEvidenceCaption">Evidence preview</span><a id="incidentOpenVideo" href="#" target="_blank" rel="noopener" hidden>Open full video</a></div>
            </div>
            <div class="incident-details">
              <div class="incident-state-row" id="incidentModalPills"></div>
              <div class="incident-facts" id="incidentModalFacts"></div>
            </div>
          </div>
          <div class="incident-dialog-actions">
            <button class="btn-dark" id="incidentModalDispatch" type="button">Confirm</button>
            <button class="btn-ghost" id="incidentModalDismiss" type="button">False</button>
          </div>
        </section>
      </div>
      <div id="ems-root" aria-hidden="true">
        <div class="ems-backdrop" id="emsBackdrop"></div>
        <div class="ems-panel" role="dialog" aria-modal="true" aria-labelledby="emsTitle">
          <div class="ems-icon">${ICON.warn}</div>
          <div id="emsFormWrap">
            <h3 id="emsTitle">Dispatch EMS</h3>
            <p>This sends the incident's location and severity to dispatch. Check the details before sending.</p>
            <form class="ems-form" id="emsForm">
              <div><label for="emsLoc">Location</label><input id="emsLoc" type="text" required></div>
              <div><label for="emsSeverity">Severity</label>
                <select id="emsSeverity">
                  <option>Unknown — confirm on arrival</option>
                  <option>Minor — no visible injuries reported</option>
                  <option selected>Moderate — possible injuries</option>
                  <option>Severe — high-impact, likely injuries</option>
                </select></div>
              <div><label for="emsUnit">Emergency unit</label>
                <select id="emsUnit" required><option value="">Loading units…</option></select></div>
              <div class="ems-actions">
                <button type="button" class="btn-ghost" id="cancelEms">Cancel</button>
                <button type="submit" class="btn-dark" id="sendEmsBtn">Send to dispatch</button>
              </div>
            </form>
          </div>
          <div class="ems-success" id="emsSuccess" style="margin-top:1rem">
            <div class="check">${ICON.check}</div>
            <h3>Dispatch notified</h3>
            <p id="emsSuccessMsg">EMS has been alerted.</p>
            <div class="ems-actions"><button class="btn-dark neutral" id="doneEms" type="button">Done</button></div>
          </div>
        </div>
      </div>`);

    wireDialogs();

    // Hidden developer access: Ctrl+Shift+D / Alt+Shift+D, or triple-click the logo.
    const goDev = () => { if (!/dev\.html$/.test(location.pathname)) location.href = "dev.html"; };
    addEventListener("keydown", e => {
      if (e.code === "KeyD" && e.shiftKey && (e.ctrlKey || e.altKey)) { e.preventDefault(); goDev(); }
    }, true);
    let clicks = 0, timer;
    $("#brandMark").addEventListener("click", e => {
      e.preventDefault(); // stop the first click reloading the page before the 3rd lands
      clicks++; clearTimeout(timer);
      if (clicks >= 3) { clicks = 0; goDev(); return; }
      timer = setTimeout(() => {
        clicks = 0;
        if (!/(index\.html|\/)$/.test(location.pathname)) location.href = "index.html";
      }, 450);
    });
  };

  CD.start = () => {
    if (!S.serverUrl) { CD.setLink("offline"); CD.emit("offline"); return; }
    // Paint last-known data immediately; fresh data replaces it a moment later.
    const ci = CD.cache.get("incidents");
    if (ci) { S.incidents = ci.d; S.incidentsLoaded = true; S.current = S.incidents[0] || null; CD.emit("incidents", S.incidents); }
    const cn = CD.cache.get("nodes");
    if (cn) { S.nodes = cn.d; S.nodesLoaded = true; const t = $("#nodeTabCount"); if (t) t.textContent = S.nodes.length; CD.emit("nodes", S.nodes); }
    CD.connect(S.serverUrl, S.jwt);
  };

  /* ---------- incident dialog ---------- */
  const modal = () => $("#incident-modal");
  function closeIncident() { modal().classList.remove("open"); modal().setAttribute("aria-hidden", "true"); }

  CD.showIncident = (raw, filename) => {
    const inc = CD.normalize(raw);
    if (!inc) return;
    S.current = inc;
    const id = inc.id || "Not yet registered";
    const c = CD.coords(inc.location);
    const severity = String(inc.severity || "unknown");
    const status = CD.cap(inc.status);
    const conf = inc.confidence == null ? null : Number(inc.confidence);

    $("#incidentModalTitle").textContent = CD.incidentTitle(inc);
    $("#incidentModalId").textContent = filename ? `${id} · ${filename}` : `Incident ${id}`;

    const pills = $("#incidentModalPills"); pills.replaceChildren();
    const g = CD.statusGroup(inc.status);
    [[status, g === "pending" ? "pending" : g === "done" || g === "active" ? "verified" : ""],
     [`Severity: ${CD.cap(severity)}`, CD.isSevere(severity) ? "alert" : ""],
     [`Confidence: ${conf == null || Number.isNaN(conf) ? "unknown" : Math.round(conf * 100) + "%"}`, ""]
    ].forEach(([t, cls]) => { const el = document.createElement("span"); el.className = `incident-pill ${cls}`; el.textContent = t; pills.appendChild(el); });

    const facts = [
      ["Camera", inc.cameraName || "Unknown camera"],
      ["Edge node", inc.device_id || "Unknown node"],
      ["Reported", inc.timestamp ? `${new Date(inc.timestamp).toLocaleString()} (${CD.ago(inc.timestamp)})` : "Not provided"],
      ["Location", CD.locationText(inc.location), true, c],
      ["Vehicles detected", inc.vehicleCount ?? inc.vehicle_count ?? "Not provided"],
      ["Confidence score", conf == null || Number.isNaN(conf) ? "Not provided" : `${Math.round(conf * 100)}%`],
      ["Incident ID", id, true]
    ];
    const root = $("#incidentModalFacts"); root.replaceChildren();
    facts.forEach(([k, v, wide, coords]) => {
      const box = document.createElement("div"); box.className = `incident-fact${wide ? " wide" : ""}`;
      const key = document.createElement("div"); key.className = "key"; key.textContent = k;
      const val = document.createElement("div"); val.className = "value"; val.textContent = String(v);
      if (coords) { const a = document.createElement("a"); a.href = `https://www.google.com/maps?q=${coords.lat},${coords.lng}`; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open in Maps"; val.appendChild(a); }
      box.append(key, val); root.appendChild(box);
    });

    const frame = $("#incidentVideoFrame"); frame.replaceChildren();
    const video = CD.mediaUrl(inc.videoUrl), snap = CD.mediaUrl(inc.snapshotImage), open = $("#incidentOpenVideo");
    if (video) {
      const v = document.createElement("video"); v.src = video; v.controls = true; v.preload = "metadata"; v.playsInline = true; v.setAttribute("aria-label", "Crash video evidence"); frame.appendChild(v);
      open.href = video; open.textContent = "Open full video"; open.hidden = false; $("#incidentEvidenceCaption").textContent = "Video evidence";
    } else if (snap) {
      const im = document.createElement("img"); im.src = snap; im.alt = "Incident snapshot"; frame.appendChild(im);
      open.href = snap; open.textContent = "Open snapshot"; open.hidden = false; $("#incidentEvidenceCaption").textContent = "Snapshot · no video attached";
    } else {
      const e = document.createElement("div"); e.className = "incident-no-video";
      e.innerHTML = "<strong>No video attached</strong><span>Footage appears here when the edge node uploads a clip.</span>";
      frame.appendChild(e); open.hidden = true; $("#incidentEvidenceCaption").textContent = "Evidence";
    }

    const btn = $("#incidentModalDispatch"), falseBtn = $("#incidentModalDismiss");
    const sent = /dispatch|respond|resolved/i.test(inc.status);
    const rejected = /reject|false/i.test(inc.status);
    const verified = /verified/i.test(inc.status) && !/unverified/i.test(inc.status);
    btn.dataset.mode = sent || rejected ? "none" : verified ? "dispatch" : "confirm";
    btn.disabled = sent || rejected;
    btn.textContent = sent ? "EMS already dispatched" : rejected ? "Marked as false" : verified ? "Dispatch EMS" : "Confirm";
    falseBtn.style.display = btn.dataset.mode === "confirm" ? "" : "none"; // only undecided reports can be marked false

    modal().classList.add("open"); modal().setAttribute("aria-hidden", "false");
    $("#closeIncidentModal").focus();
  };

  /* ---------- review decision: Confirm (real accident) / False ---------- */
  CD.confirmIncident = () => {
    const inc = S.current;
    if (!inc) return;
    const id = inc.id || `LOCAL-${Date.now()}`;

    // Confirming the accident and dispatching EMS are independent decisions.
    CD.accidentLog.add(id, "accident");
    S.current = { ...inc, id, status: "VERIFIED", confirmedAt: inc.confirmedAt || new Date().toISOString() };
    const row = S.incidents.find(i => String(i.id) === String(id));
    if (row) { row.status = "VERIFIED"; row.confirmedAt = S.current.confirmedAt; }
    CD.responseLog.upsert({
      incidentId: id,
      incidentLocation: CD.locationText(inc.location),
      cameraName: inc.cameraName || inc.device_id || "Unknown camera",
      severity: inc.severity || "unknown",
      status: "CONFIRMED_AWAITING_DISPATCH",
      unitId: null,
      unitName: null,
      confirmedAt: S.current.confirmedAt
    });
    CD.log(`Accident confirmed · incident ${id}`, "crit");
    CD.toast("Accident logged. EMS dispatch is optional.", "ok");
    CD.emit("confirmed", S.current);
    CD.emit("incidents", S.incidents);
    closeIncident();

    // The dispatch dialog is optional. Cancelling it never reverses confirmation.
    CD.openEms();

    // Persist confirmation on the server independently from EMS dispatch.
    if (S.serverUrl && inc.id && !String(inc.id).startsWith("LOCAL-")) {
      CD.api(`/api/incidents/${encodeURIComponent(inc.id)}/verify`, { method: "PATCH", body: JSON.stringify({}) })
        .then(async r => {
          if (!r.ok) {
            const b = await r.json().catch(() => ({}));
            const e = httpErr(r, "Verify request failed");
            e.serverMessage = b.message || b.error || "";
            throw e;
          }
          CD.accidentLog.remove(id, "accident");
          CD.loadIncidents();
          CD.emit("confirmed", S.current);
        })
        .catch(err => {
          CD.log(`Could not verify incident on server · ${err.message}${err.serverMessage ? " · " + err.serverMessage : ""}`, "crit");
          const why = err.status === 401 || err.status === 403 ? `the server refused the login token (${err.status})`
            : err.status === 404 ? "the server doesn't have this incident (404)"
            : err.status ? `the server answered with an error (${err.status}${err.serverMessage ? ": " + err.serverMessage : ""})`
            : `no response from ${S.serverUrl || "the server"}, it may be down, blocked or the URL is wrong`;
          CD.toast(`Accident remains logged locally; server sync failed: ${why}.`, "crit");
        });
    }
  };

  CD.rejectIncident = async () => {
    const inc = S.current;
    if (!inc) { closeIncident(); return; }
    if (S.serverUrl && inc.id && !String(inc.id).startsWith("LOCAL-")) {
      try {
        const r = await CD.api(`/api/incidents/${encodeURIComponent(inc.id)}/reject`, { method: "PATCH" });
        if (!r.ok) throw httpErr(r, "Reject request failed");
        CD.loadIncidents();
      } catch (err) { CD.log(`Could not reject incident on server · ${err.message}`, "crit"); }
    }
    S.current = { ...inc, status: "REJECTED" };
    CD.log(`Marked false · incident ${inc.id || "unregistered"}`);
    CD.toast("Marked as false. Not counted as an accident.", "info");
    closeIncident();
  };

  /* ---------- EMS dispatch ---------- */
  // DEMO MODE: true = dispatch is simulated locally and NO emergency service is contacted.
  // Set to false to use the real backend call (POST /api/incidents/:id/dispatch).
  CD.EMS_DEMO = true;

  // PLACEHOLDER provider. Replace send() with a call to your own backend, which talks to the
  // real CAD / ambulance dispatch API (keep provider credentials server-side, never in the browser).
  CD.emsDemoUnits = [
    { id: "demo_a1", unitName: "Ambulance A-1", unitType: "ambulance", status: "AVAILABLE" },
    { id: "demo_a2", unitName: "Ambulance A-2", unitType: "ambulance", status: "AVAILABLE" },
    { id: "demo_m1", unitName: "Medic M-1", unitType: "paramedic car", status: "AVAILABLE" },
    { id: "demo_r1", unitName: "Rescue R-1", unitType: "rescue", status: "AVAILABLE" }
  ];
  CD.emsProvider = {
    async send(packet) {
      await new Promise(r => setTimeout(r, 800 + Math.random() * 600)); // fake network latency
      const unit = CD.emsDemoUnits.find(u => u.id === packet.unitId);
      if (!unit || unit.status !== "AVAILABLE") throw new Error("That unit is no longer available");
      unit.status = "DISPATCHED";
      setTimeout(() => { unit.status = "AVAILABLE"; }, 20000); // unit frees up after 20s
      const result = { simulated: true, ref: "SIM-" + Math.floor(1000 + Math.random() * 9000), etaMinutes: 4 + Math.floor(Math.random() * 8) };
      CD.log(`[SIMULATED] Would notify EMS · ${JSON.stringify(packet)} → ${result.ref}`, "crit");
      return result;
    }
  };
  // With no live incident selected, the header "Contact EMS" button still works in demo mode.
  const emsIncident = () => S.current || (CD.EMS_DEMO ? { id: "DEMO-INCIDENT", location: null, severity: "unknown" } : null);
  let emsLocRaw = "", emsLocShown = "";
  const ems = () => $("#ems-root");

  CD.openEms = () => {
    if (!CD.EMS_DEMO && !S.serverUrl) { CD.toast("Not connected to the CrashDet service.", "crit"); return; }
    const inc = emsIncident();
    if (!inc) { CD.toast("There's no incident to dispatch for yet.", "info"); return; }
    if (!inc.id) { CD.toast("This report isn't registered yet, so it can't be dispatched.", "crit"); return; }
    CD.loadUnits();
    emsLocRaw = !inc.location ? "" : typeof inc.location === "string" ? inc.location : JSON.stringify(inc.location);
    emsLocShown = inc.location ? CD.locationText(inc.location) : "";
    $("#emsLoc").value = emsLocShown;
    const sev = String(inc.severity);
    $("#emsSeverity").selectedIndex = /severe|critical|high/i.test(sev) ? 3 : /moderate|medium/i.test(sev) ? 2 : /minor|low/i.test(sev) ? 1 : 0;
    ems().classList.add("open"); ems().setAttribute("aria-hidden", "false");
  };
  function closeEms() {
    ems().classList.remove("open"); ems().setAttribute("aria-hidden", "true");
    setTimeout(() => { $("#emsFormWrap").style.display = ""; $("#emsSuccess").classList.remove("show"); const b = $("#sendEmsBtn"); b.disabled = false; b.textContent = "Send to dispatch"; }, 300);
  }

  function wireDialogs() {
    $("#closeIncidentModal").addEventListener("click", closeIncident);
    $("#incidentModalDismiss").addEventListener("click", () => CD.rejectIncident());
    $("#incidentModalBackdrop").addEventListener("click", closeIncident);
    $("#incidentModalDispatch").addEventListener("click", () => {
      if ($("#incidentModalDispatch").dataset.mode === "dispatch") { closeIncident(); CD.openEms(); } // already confirmed earlier
      else CD.confirmIncident();
    });
    $("#openEms").addEventListener("click", CD.openEms);
    $("#emsBackdrop").addEventListener("click", closeEms);
    $("#cancelEms").addEventListener("click", closeEms);
    $("#doneEms").addEventListener("click", closeEms);
    addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (modal().classList.contains("open")) closeIncident();
      if (ems().classList.contains("open")) closeEms();
    });

    $("#emsForm").addEventListener("submit", async e => {
      e.preventDefault();
      const inc = emsIncident();
      if ((!CD.EMS_DEMO && !S.serverUrl) || !inc?.id) { CD.toast("Select a registered incident before dispatching.", "crit"); return; }
      const unitId = $("#emsUnit").value;
      if (!unitId) { CD.toast("Choose an available unit first.", "crit"); return; }
      const btn = $("#sendEmsBtn");
      btn.disabled = true; btn.textContent = "Sending…";
      const locField = $("#emsLoc").value;
      const payload = { location: locField === emsLocShown && emsLocRaw ? emsLocRaw : locField, severity: $("#emsSeverity").value, assignedUnit: unitId, unitId };
      try {
        let result;
        if (CD.EMS_DEMO) {
          result = await CD.emsProvider.send({ incidentId: inc.id, ...payload });   // simulated, no real call
          CD.accidentLog.add(`${inc.id}:${result.ref}`, "ems");
          if (S.current) S.current = { ...inc, status: "DISPATCHED" };
        } else {
          const r = await CD.api(`/api/incidents/${encodeURIComponent(inc.id)}/dispatch`, { method: "POST", body: JSON.stringify(payload) });
          result = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(result.message || result.error || `Dispatch failed (${r.status})`);
          S.current = CD.normalize(result) || { ...inc, status: "DISPATCHED" };
        }
        $("#emsFormWrap").style.display = "none"; $("#emsSuccess").classList.add("show");
        const u = S.units.find(x => String(x._id || x.id || x.unitId) === String(unitId))
          || CD.emsDemoUnits.find(x => String(x.id) === String(unitId));
        const unitName = u?.unitName || u?.name || u?.unitId || u?.id || unitId;
        CD.responseLog.upsert({
          incidentId: inc.id,
          incidentLocation: CD.locationText(payload.location || inc.location),
          cameraName: inc.cameraName || inc.device_id || "Unknown camera",
          severity: payload.severity || inc.severity || "unknown",
          status: "DISPATCHED",
          unitId: String(unitId),
          unitName,
          dispatchRef: result?.ref || result?.dispatchId || result?._id || null,
          etaMinutes: result?.etaMinutes ?? result?.eta ?? null,
          simulated: Boolean(result?.simulated),
          dispatchedAt: new Date().toISOString()
        });
        $("#emsSuccessMsg").textContent = `${unitName} has been ${result?.simulated ? "simulated as notified" : "submitted for dispatch"}.${result?.simulated ? ` (SIMULATED · ref ${result.ref} · ETA ~${result.etaMinutes} min · no real call placed)` : ""}`;
        CD.log(`${result?.simulated ? "Simulated EMS assignment" : "EMS dispatch requested"} · ${unitName} · incident ${inc.id}`, "crit");
        CD.loadIncidents(); CD.loadUnits(); CD.emit("dispatched", inc);
      } catch (err) {
        CD.log(`EMS dispatch failed · ${err.message}`, "crit");
        CD.toast(`Dispatch didn't go through. ${err.message}`, "crit");
        btn.disabled = false; btn.textContent = "Send to dispatch";
      }
    });
  }

  // Keep REST refresh running even when Socket.IO claims to be connected.
  // This prevents stale screens if an event is missed or the socket path is blocked.
  let pollTimer = null;
  CD.on("link", state => {
    clearInterval(pollTimer);
    pollTimer = null;
    if (state === "auth" || state === "live") {
      pollTimer = setInterval(() => {
        if (!document.hidden) CD.emit("poll");
      }, 5000);
    }
  });
  CD.on("poll", () => {
    CD.loadIncidents();
    if (CD.page === "nodes") CD.loadNodes();
  });

  CD.on("sync", () => {
    CD.loadIncidents();
    if (CD.page === "nodes") CD.loadNodes();
    else if (CD.page === "dashboard") setTimeout(CD.loadNodes, 1500); // low priority: only feeds the tab badge
  });
})();
