/**
 * CrashDet backend
 * ------------------------------------------------------------
 * Endpoints:
 *   POST /api/reports          <- Android app posts a crash report JSON here
 *   GET  /api/reports          <- list recent reports (dashboard uses on load)
 *   GET  /api/reports/stream   <- Server-Sent Events, dashboard subscribes for live updates
 *   POST /api/ems/dispatch     <- dashboard calls this when "Send to dispatch" is pressed
 *   GET  /api/stats            <- rolling counters (accidents, ems deployed, freq/hr, hourly heat buckets)
 *   GET  /healthz              <- uptime check
 *
 * Storage: in-memory (swap the arrays below for a real DB — Postgres/SQLite/etc — before production use).
 * Auth: none yet. Before exposing this publicly, add an API key check (see AUTH note below).
 */

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());                       // allow the dashboard (any origin) to call these endpoints
app.use(express.json({ limit: "1mb" })); // parse JSON bodies

// ---------------------------------------------------------------
// AUTH (recommended before going live): require a shared API key from the Android app.
// Uncomment and set CRASHDET_API_KEY as an environment variable to enable.
// ---------------------------------------------------------------
const API_KEY = process.env.CRASHDET_API_KEY || null;
function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // auth disabled until you set CRASHDET_API_KEY
  const key = req.header("x-api-key");
  if (key !== API_KEY) return res.status(401).json({ error: "invalid or missing x-api-key header" });
  next();
}

// ---------------------------------------------------------------
// In-memory store (resets on server restart)
// ---------------------------------------------------------------
const reports = [];      // every crash report ever received
const dispatches = [];   // every EMS dispatch action
const sseClients = [];   // connected dashboard(s) listening for live pushes

function broadcast(event, payload) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach((res) => res.write(line));
}

// ---------------------------------------------------------------
// POST /api/reports  — the Android app calls this on every detected crash
// ---------------------------------------------------------------
app.post("/api/reports", requireApiKey, (req, res) => {
  const body = req.body || {};

  // Minimal shape validation — adjust required fields to match your app's payload
  if (typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "request body must be a JSON object" });
  }

  const report = {
    id: "rpt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    received_at: new Date().toISOString(),
    device_id: body.device_id || "unknown-device",
    timestamp: body.timestamp || new Date().toISOString(),
    location: body.location || null,        // e.g. { lat, lng, label }
    severity: body.severity || "unknown",     // "minor" | "moderate" | "severe" | "unknown"
    impact_g: body.impact_g ?? null,
    confidence: body.confidence ?? null,
    raw: body,
  };

  reports.unshift(report);
  if (reports.length > 500) reports.pop(); // cap memory use

  broadcast("report", report);
  res.status(201).json({ ok: true, id: report.id, received_at: report.received_at });
});

// ---------------------------------------------------------------
// GET /api/reports — dashboard loads recent history on page load
// ---------------------------------------------------------------
app.get("/api/reports", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  res.json({ reports: reports.slice(0, limit) });
});

// ---------------------------------------------------------------
// GET /api/reports/stream — Server-Sent Events, dashboard keeps this open for live updates
// ---------------------------------------------------------------
app.get("/api/reports/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  sseClients.push(res);
  const keepAlive = setInterval(() => res.write(":ping\n\n"), 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    const i = sseClients.indexOf(res);
    if (i !== -1) sseClients.splice(i, 1);
  });
});

// ---------------------------------------------------------------
// POST /api/ems/dispatch — dashboard operator confirms "Send to dispatch"
// ---------------------------------------------------------------
app.post("/api/ems/dispatch", requireApiKey, (req, res) => {
  const { report_id, location, severity, notes } = req.body || {};

  const dispatch = {
    id: "disp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    dispatched_at: new Date().toISOString(),
    report_id: report_id || null,
    location: location || null,
    severity: severity || "unknown",
    notes: notes || "",
  };

  dispatches.unshift(dispatch);
  if (dispatches.length > 500) dispatches.pop();

  broadcast("dispatch", dispatch);
  res.status(201).json({ ok: true, id: dispatch.id, dispatched_at: dispatch.dispatched_at });
});

app.get("/api/dispatches", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  res.json({ dispatches: dispatches.slice(0, limit) });
});

// ---------------------------------------------------------------
// GET /api/stats — rolling counters the dashboard's KPI cards + heatmap use
// ---------------------------------------------------------------
app.get("/api/stats", (req, res) => {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;

  const todayReports = reports.filter((r) => now - new Date(r.received_at).getTime() < dayMs);
  const todayDispatches = dispatches.filter((d) => now - new Date(d.dispatched_at).getTime() < dayMs);
  const lastHourReports = reports.filter((r) => now - new Date(r.received_at).getTime() < hourMs);

  // hourly buckets (0-23) across all stored reports, for the heatmap
  const heatBuckets = new Array(24).fill(0);
  reports.forEach((r) => {
    const h = new Date(r.received_at).getHours();
    heatBuckets[h]++;
  });

  res.json({
    accidents_today: todayReports.length,
    ems_deployed_today: todayDispatches.length,
    frequency_per_hour: +lastHourReports.length.toFixed(1),
    heat_buckets: heatBuckets,
    total_reports: reports.length,
    total_dispatches: dispatches.length,
  });
});

app.get("/healthz", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CrashDet backend listening on port ${PORT}`);
  if (!API_KEY) console.log("⚠️  CRASHDET_API_KEY not set — endpoints are open. Set it before going live.");
});
