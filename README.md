# CrashDet backend

A small Express server that receives crash reports from the Android app and
pushes them live to the operator dashboard.

## Endpoints

| Method | Path                     | Called by        | Purpose                                   |
|--------|--------------------------|-------------------|--------------------------------------------|
| POST   | `/api/reports`           | Android app       | Submit a new crash report                  |
| GET    | `/api/reports`           | Dashboard         | Load recent report history                 |
| GET    | `/api/reports/stream`    | Dashboard         | Server-Sent Events — live push of new reports/dispatches |
| POST   | `/api/ems/dispatch`      | Dashboard         | Record an EMS dispatch action              |
| GET    | `/api/dispatches`        | Dashboard         | List EMS dispatch history                  |
| GET    | `/api/stats`             | Dashboard         | Rolling KPI counters + 24h heatmap buckets |
| GET    | `/healthz`               | anyone            | Uptime check                               |

See `android-integration.md` for the exact request shape and a Kotlin snippet.

## Run it locally

```bash
npm install
node server.js
# CrashDet backend listening on port 3000
```

Test it:
```bash
curl -X POST http://localhost:3000/api/reports \
  -H "Content-Type: application/json" \
  -d '{"device_id":"node-01","severity":"severe","location":{"lat":1,"lng":2,"label":"Test St"}}'
```

Then open `dashboard.html` in a browser, paste `http://localhost:3000` into the
**Server connection** field at the top, and click **Connect** — the report you
just sent should already show up, and any new ones will stream in live.

## Securing it (do this before your phone talks to it over the open internet)

Set an API key as an environment variable:

```bash
export CRASHDET_API_KEY="pick-a-long-random-string"
node server.js
```

Once set, `/api/reports` and `/api/ems/dispatch` require an `x-api-key` header
matching it. Put the same value in your Android app's `CrashReporter.API_KEY`
and in the dashboard (store it via `localStorage.setItem('crashdet_api_key', '...')`
in the browser console, or I can add a field for it in the UI if you'd like).

Also worth adding before a real deployment:
- HTTPS (any of the hosts below give you this for free)
- A real database instead of the in-memory arrays (Postgres, SQLite, etc.) — right now
  all reports are lost on server restart
- Rate limiting on `/api/reports` so a malfunctioning node can't flood it

## Deploying it so your phone can actually reach it

This needs to run somewhere with a public URL. A few easy, mostly-free options:

- **Render.com** — connect a GitHub repo with this folder, "New Web Service",
  build command `npm install`, start command `node server.js`. Set
  `CRASHDET_API_KEY` in its environment variables tab.
- **Railway.app** — same idea, one-click deploy from a repo.
- **Fly.io** — `fly launch` in this folder, then `fly deploy`.
- **A Raspberry Pi / home server + ngrok** — good for quick testing:
  `npx ngrok http 3000` gives you a temporary public HTTPS URL pointing at your
  local `node server.js`.

Whichever you pick, once it's live you'll have a URL like
`https://crashdet-backend.onrender.com` — put that in the Android app's
`BASE_URL` and in the dashboard's **Server connection** field.

## Files

- `server.js` — the backend
- `android-integration.md` — request format + Kotlin/OkHttp example
- `package.json` — dependencies (`express`, `cors`)
