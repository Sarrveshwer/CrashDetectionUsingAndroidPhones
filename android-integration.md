# Sending a crash report from the Android app

Point your app at your deployed backend's base URL, then POST a JSON body to
`/api/reports` whenever the on-device model confirms a crash.

## Request

```
POST https://your-crashdet-server.example.com/api/reports
Content-Type: application/json
x-api-key: <same key as CRASHDET_API_KEY on the server>   // only if you set one

{
  "device_id": "node-0417",
  "timestamp": "2026-09-22T14:03:11Z",
  "location": { "lat": 30.2672, "lng": -97.7431, "label": "5th St & Congress Ave" },
  "severity": "severe",
  "impact_g": 8.4,
  "confidence": 0.93
}
```

`device_id`, `severity`, `location` and `timestamp` are the fields the dashboard displays;
add anything else you want (speed, heading, battery, photo URL, etc.) — extra fields are
stored under `raw` and shown in the JSON viewer either way.

## Kotlin (OkHttp) — drop this in your existing crash-detection service

```kotlin
import okhttp3.*
import org.json.JSONObject
import java.io.IOException

object CrashReporter {
    private val client = OkHttpClient()
    private val JSON = "application/json; charset=utf-8".toMediaType()

    // Set these once, e.g. from BuildConfig or a settings screen
    private const val BASE_URL = "https://your-crashdet-server.example.com"
    private const val API_KEY = ""  // leave blank if the server has no CRASHDET_API_KEY set

    fun sendReport(
        deviceId: String,
        severity: String,       // "minor" | "moderate" | "severe" | "unknown"
        lat: Double, lng: Double, label: String,
        impactG: Double, confidence: Double
    ) {
        val body = JSONObject().apply {
            put("device_id", deviceId)
            put("timestamp", java.time.Instant.now().toString())
            put("location", JSONObject().apply {
                put("lat", lat); put("lng", lng); put("label", label)
            })
            put("severity", severity)
            put("impact_g", impactG)
            put("confidence", confidence)
        }

        val requestBuilder = Request.Builder()
            .url("$BASE_URL/api/reports")
            .post(RequestBody.create(JSON, body.toString()))
        if (API_KEY.isNotBlank()) requestBuilder.addHeader("x-api-key", API_KEY)

        client.newCall(requestBuilder.build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                // TODO: queue and retry — don't lose a crash report to a dropped connection
            }
            override fun onResponse(call: Call, response: Response) {
                response.close() // 201 = accepted
            }
        })
    }
}
```

Add the internet permission if it isn't already there:

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

### Reliability notes for a device that might be offline mid-crash
- Wrap the send in a small retry queue (WorkManager one-off request is a good fit) so a
  report isn't lost if the phone's data connection drops at the moment of impact.
- Consider sending a lightweight "I'm alive" heartbeat every few minutes to a
  `/api/reports` with `severity: "heartbeat"` (or a separate endpoint) so the dashboard can
  tell a silent node apart from a healthy one with no crashes.

## Testing without a phone

```bash
curl -X POST https://your-crashdet-server.example.com/api/reports \
  -H "Content-Type: application/json" \
  -d '{"device_id":"node-0417","severity":"severe","location":{"lat":30.27,"lng":-97.74,"label":"Test Ave"},"impact_g":8.1,"confidence":0.9}'
```
