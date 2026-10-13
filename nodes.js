/* CrashDet — edge nodes page */
(function () {
  const { $, esc, state: S } = CD;
  CD.mount("nodes");

  const id = n => String(n.deviceId || n.device_id || n.id || n._id || "");
  function status(n) {
    const raw = String(n.effectiveStatus || n.effective_status || n.status || "UNKNOWN").toUpperCase();
    if (raw.includes("MAINTENANCE")) return "MAINTENANCE";
    if (["ONLINE", "CONNECTED", "ACTIVE"].includes(raw)) return "ONLINE";
    if (["OFFLINE", "DISCONNECTED", "INACTIVE"].includes(raw)) return "OFFLINE";
    const hb = n.lastHeartbeat || n.last_heartbeat;
    if (hb) return Date.now() - new Date(hb).getTime() < 5 * 60 * 1000 ? "ONLINE" : "OFFLINE";
    return "UNKNOWN";
  }
  function heartbeat(n) {
    const v = n.lastHeartbeat || n.last_heartbeat || n.updatedAt || n.updated_at;
    if (!v) return { text: "No check-in yet", title: "" };
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? { text: String(v), title: "" } : { text: CD.ago(v), title: d.toLocaleString() };
  }
  const safe = v => esc(v == null || v === "" ? "—" : String(v));
  const humanKey = k => CD.cap(k.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "));
  const HIDE = /^(_id|__v|id|password|token|secret|jwt|api.?key)$/i;

  function details(n) {
    return Object.entries(n)
      .filter(([k, v]) => !HIDE.test(k) && v != null && v !== "" && typeof v !== "object")
      .map(([k, v]) => `<div class="field"><div class="k">${esc(humanKey(k))}</div><div class="v">${safe(v)}</div></div>`)
      .join("") || '<div class="empty-note">No additional details.</div>';
  }

  function render() {
    const list = $("#nodeList");
    const nodes0 = S.nodes;
    const online = nodes0.filter(n => status(n) === "ONLINE").length;
    $("#nodeTotal").textContent = nodes0.length;
    $("#nodeOnline").textContent = online;
    $("#nodeOffline").textContent = nodes0.length - online;

    if (!S.serverUrl) { list.innerHTML = note("Not connected", "Edge nodes will be listed here once the dashboard is linked to the CrashDet service."); return; }
    if (!S.nodesLoaded) { list.innerHTML = '<div class="skeleton" style="height:9rem"></div><div class="skeleton" style="height:9rem"></div>'; return; }
    if (S.nodesError) { list.innerHTML = note("Couldn't load nodes", "Try refreshing in a moment."); return; }

    const q = ($("#nodeSearch").value || "").trim().toLowerCase();
    const sf = $("#nodeStatusFilter").value, sort = $("#nodeSort").value;
    const nodes = nodes0.filter(n => {
      const hay = [id(n), n.name, n.model, n.cameraId, n.camera_id, n.ipAddress, n.ip_address].join(" ").toLowerCase();
      return (!q || hay.includes(q)) && (sf === "ALL" || status(n) === sf);
    }).sort((a, b) => {
      if (sort === "name") return String(a.name || id(a)).localeCompare(String(b.name || id(b)));
      if (sort === "heartbeat") return new Date(b.lastHeartbeat || b.last_heartbeat || 0) - new Date(a.lastHeartbeat || a.last_heartbeat || 0);
      const rank = { ONLINE: 0, MAINTENANCE: 1, UNKNOWN: 2, OFFLINE: 3 };
      return (rank[status(a)] ?? 2) - (rank[status(b)] ?? 2);
    });

    if (!nodes.length) {
      list.style.gridTemplateColumns = "1fr";
      list.innerHTML = note(nodes0.length ? "No matches" : "No edge nodes yet", nodes0.length ? "Try a different search or status filter." : "Devices appear here after they register with the service.");
      return;
    }
    list.style.gridTemplateColumns = "";
    list.innerHTML = "";
    nodes.forEach((n, i) => {
      const nid = id(n) || `unknown-${i}`, st = status(n), hb = heartbeat(n);
      const card = document.createElement("article");
      card.className = "node-card";
      card.innerHTML = `
        <div class="node-title"><div><h3>${safe(n.name || n.deviceName || "Unnamed edge node")}</h3></div><span class="node-status ${st.toLowerCase()}">${CD.cap(st)}</span></div>
        <div class="node-meta">
          <div class="field"><div class="k">Device model</div><div class="v">${safe(n.model || n.deviceModel)}</div></div>
          <div class="field"><div class="k">Camera</div><div class="v">${safe(n.cameraId || n.camera_id || "Unassigned")}</div></div>
          <div class="field"><div class="k">Last check-in</div><div class="v" title="${esc(hb.title)}">${safe(hb.text)}</div></div>
          <div class="field"><div class="k">App / Android</div><div class="v">${safe(n.appVersion || n.app_version)} / ${safe(n.androidVersion || n.android_version)}</div></div>
        </div>
        <div class="node-actions"><button class="btn-ghost node-copy" type="button">Copy device ID</button><button class="btn-ghost node-toggle" type="button" aria-expanded="false">More details</button></div>
        <div class="node-details">${details(n)}</div>`;
      card.querySelector(".node-copy").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(nid); CD.toast("Device ID copied", "ok"); }
        catch { CD.toast(`Device ID: ${nid}`); }
      });
      card.querySelector(".node-toggle").addEventListener("click", e => {
        const d = card.querySelector(".node-details"); d.classList.toggle("open");
        const open = d.classList.contains("open");
        e.currentTarget.textContent = open ? "Hide details" : "More details";
        e.currentTarget.setAttribute("aria-expanded", String(open));
      });
      list.appendChild(card);
    });
  }
  const note = (t, p) => `<div class="empty" style="grid-column:1/-1"><h3>${esc(t)}</h3><p>${esc(p)}</p></div>`;

  $("#nodeSearch").addEventListener("input", render);
  $("#nodeStatusFilter").addEventListener("change", render);
  $("#nodeSort").addEventListener("change", render);
  $("#refreshNodes").addEventListener("click", async () => {
    const b = $("#refreshNodes"); b.disabled = true; b.textContent = "Refreshing…";
    await CD.loadNodes();
    b.disabled = false; b.textContent = "Refresh";
  });

  CD.on("nodes", render);
  CD.on("poll", () => CD.loadNodes());
  CD.on("offline", render);
  setInterval(() => { if (S.nodesLoaded && !document.querySelector(".node-details.open")) render(); }, 60000);
  render();
  CD.start();
})();
