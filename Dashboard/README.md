# CrashDet Backend

A lightweight Express.js-based server application designed to receive crash report data from an Android mobile application and transmit those events in real time to an operator-facing dashboard interface. The system functions as the central middleware layer between field mobile devices and a monitoring console, enabling immediate visibility into system failures as they occur.

## API Endpoint Reference

### POST /api/reports
This endpoint accepts crash report submissions from the Android client. The request body should include a JSON object containing at minimum a device identifier, severity classification, and geographic coordinates with an optional descriptive label. When properly formatted data is received, the server stores the report in memory and triggers downstream notification processes. This is the primary ingestion point for all crash telemetry.

### GET /api/reports
Retrieves a paginated list of previously received crash reports. This endpoint supports query parameters for filtering by time range, severity level, and device ID, allowing the dashboard to display historical crash data on demand. Results are returned as an array of report objects sorted by timestamp in descending order.

### GET /api/reports/stream
Establishes a Server-Sent Events (SSE) connection that pushes new crash reports to connected clients as they are received. This endpoint enables live dashboard updates without requiring periodic polling. Clients maintain an open HTTP connection, and the server sends a JSON payload for each new report that arrives. The connection persists until explicitly closed by either the client or server.

### POST /api/ems/dispatch
Records an Emergency Medical Services dispatch action within the system. This endpoint is used when operator personnel coordinate a response to a reported crash incident. The request body should contain details about the dispatch, including timestamps, responder information, and status updates. This data contributes to the overall incident tracking and reporting metrics.

### GET /api/dispatches
Returns a comprehensive history of all EMS dispatch events that have been logged through the system. This endpoint supports filtering by date range and status, enabling operators to review past response actions and outcomes. The response includes complete dispatch records with associated metadata.

### GET /api/stats
Provides rolling key performance indicator statistics and 24-hour heatmap data buckets. This endpoint calculates and returns aggregated metrics including total report count, severity distribution, average response times, and geographic clustering of incident locations within the last 24-hour window. The data is particularly useful for identifying trends and resource allocation patterns.

### GET /healthz
A simple health check endpoint that returns a success status code without requiring authentication. This is typically used by monitoring systems and load balancers to determine service availability and uptime.

*Reference:* Detailed request schemas, expected payload structures, and a Kotlin code example using OkHttp for the Android integration can be found in the `android-integration.md` documentation file.

## Local Development Setup

To run the backend locally for development or testing purposes:

1. Ensure Node.js and npm are installed on your machine
2. Navigate to the project directory in your terminal
3. Install the required dependencies by running `npm install`
4. Start the server with the command `node server.js`
5. The console will display a confirmation message indicating the CrashDet backend is listening on port 3000

### Testing the Report Submission

You can verify the API is functioning correctly by sending a test POST request using curl:

```bash
curl -X POST http://localhost:3000/api/reports \
  -H "Content-Type: application/json" \
  -d '{"device_id":"node-01","severity":"severe","location":{"lat":1,"lng":2,"label":"Test St"}}'
```

If the request is successful, the server will acknowledge receipt of the report.

### Dashboard Integration

After starting the server and sending a test report, open the `dashboard.html` file in your preferred web browser. Locate the **Server connection** field at the top of the interface and enter `http://localhost:3000`. Click the **Connect** button. The report you just submitted should appear immediately in the dashboard display, and any subsequently submitted reports will stream in live through the Server-Sent Events connection.

## Security Configuration

### API Key Authentication

Before exposing the server to any network beyond local development, it is essential to configure API key authentication. This prevents unauthorized access and ensures that only clients with valid credentials can submit reports or record dispatch actions.

To set up an API key:

```bash
export CRASHDET_API_KEY="pick-a-long-random-string"
node server.js
```

Replace `"pick-a-long-random-string"` with a secure, randomly generated value of sufficient length and complexity. The API key must be kept confidential and not committed to version control or shared publicly.

Once the environment variable is set, two endpoints will require the `x-api-key` header to match the configured value:

- `/api/reports` - for submitting crash reports
- `/api/ems/dispatch` - for recording EMS dispatch actions

### Frontend Integration

In the web dashboard interface, the API key can be stored using browser local storage:

```javascript
localStorage.setItem('crashdet_api_key', 'your-api-key-here')
```

The Android application should also be configured with the same API key value through the `CrashReporter.API_KEY` constant. This ensures consistent authentication across all client platforms.

### Pre-Deployment Checklist

Before deploying to a production environment, the following items should be addressed:

- **HTTPS Everywhere**: Configure HTTPS for all external-facing connections. Many cloud hosting providers offer free SSL/TLS certificates through Let's Encrypt or similar services.
- **Persistent Data Storage**: The current implementation uses in-memory arrays for data storage, meaning all reports are lost when the server process restarts. For production use, integrate a proper database system such as PostgreSQL, MongoDB, or SQLite to ensure data persistence.
- **Request Rate Limiting**: Implement rate limiting mechanisms on the `/api/reports` endpoint to prevent abuse or accidental flooding from malfunctioning client devices. This helps maintain service availability and protects against denial-of-service scenarios.
- **Input Validation**: Ensure all incoming data is properly validated and sanitized to prevent injection attacks and malformed payload processing.
- **CORS Configuration**: Adjust Cross-Origin Resource Sharing settings to restrict which origins are permitted to interact with the API, reducing exposure to cross-site request forgery attacks.

## Quick Start

### 1. Start MongoDB
```bash
mongod --dbpath ./data/db
```

### 2. Backend Server
```bash
cd server
cp .env.example .env  # Or create with your MongoDB URI and JWT secret
npm install
npm run dev          # Development with nodemon running on port 5001
```

### 3. Frontend Client
```bash
cd client
npm install
npm run dev          # Vite dev server running on port 5173
```

### 4. Android App
Build and run the `accident/` module on your Android device. The app sends camera frames to the Python processing pipeline.

### 5. Test Detection
```bash
python gate.py sample.mp4 output.mp4 --camera phone_001 --mode auto
```

---