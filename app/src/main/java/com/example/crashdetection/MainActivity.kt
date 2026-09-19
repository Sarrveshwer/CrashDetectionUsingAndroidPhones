package com.example.crashdetection

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.location.Location
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.example.crashdetection.api.RetrofitClient
import com.example.crashdetection.models.EdgeDeviceRegistration
import com.example.crashdetection.models.HeartbeatRequest
import com.example.crashdetection.utils.DeviceUtils
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private lateinit var deviceIdText: TextView
    private lateinit var statusText: TextView
    private lateinit var statusIndicator: View
    private lateinit var logText: TextView

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var lastLocation: Location? = null
    
    private val heartbeatHandler = Handler(Looper.getMainLooper())
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            sendHeartbeat()
            heartbeatHandler.postDelayed(this, 30000) // 30 seconds
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContentView(R.layout.activity_main)
        
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.main)) { v, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom)
            insets
        }

        deviceIdText = findViewById(R.id.deviceIdText)
        statusText = findViewById(R.id.statusText)
        statusIndicator = findViewById(R.id.statusIndicator)
        logText = findViewById(R.id.logText)

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        val deviceId = DeviceUtils.getDeviceId(this)
        deviceIdText.text = deviceId

        requestLocationPermission()
        registerDevice(deviceId)
    }

    private fun requestLocationPermission() {
        val locationPermissionRequest = registerForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions()
        ) { permissions ->
            when {
                permissions.getOrDefault(Manifest.permission.ACCESS_FINE_LOCATION, false) -> {
                    addLog("Location permission granted")
                    getLastLocation()
                }
                permissions.getOrDefault(Manifest.permission.ACCESS_COARSE_LOCATION, false) -> {
                    addLog("Coarse location permission granted")
                    getLastLocation()
                }
                else -> {
                    addLog("Location permission denied")
                }
            }
        }

        locationPermissionRequest.launch(arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ))
    }

    @SuppressLint("MissingPermission")
    private fun getLastLocation() {
        fusedLocationClient.lastLocation.addOnSuccessListener { location ->
            if (location != null) {
                lastLocation = location
                addLog("Location acquired: ${location.latitude}, ${location.longitude}")
            }
        }
    }

    private fun registerDevice(deviceId: String) {
        val registration = EdgeDeviceRegistration(
            deviceId = deviceId,
            deviceName = DeviceUtils.getDeviceName(),
            deviceModel = android.os.Build.MODEL,
            androidVersion = DeviceUtils.getAndroidVersion(),
            appVersion = DeviceUtils.getAppVersion(this)
        )

        lifecycleScope.launch {
            try {
                addLog("Attempting registration...")
                val response = RetrofitClient.instance.registerDevice(registration)
                if (response.isSuccessful) {
                    addLog("Registration successful!")
                    updateStatus(true)
                    startHeartbeatLoop()
                } else {
                    addLog("Registration failed: ${response.code()}")
                    updateStatus(false)
                }
            } catch (e: Exception) {
                addLog("Network Error: ${e.message}")
                updateStatus(false)
            }
        }
    }

    private fun startHeartbeatLoop() {
        addLog("Starting 30s heartbeat loop...")
        heartbeatHandler.post(heartbeatRunnable)
    }

    private fun sendHeartbeat() {
        val deviceId = DeviceUtils.getDeviceId(this)
        val request = HeartbeatRequest(
            status = "ONLINE",
            latitude = lastLocation?.latitude,
            longitude = lastLocation?.longitude
        )

        lifecycleScope.launch {
            try {
                val response = RetrofitClient.instance.sendHeartbeat(deviceId, request)
                if (response.isSuccessful) {
                    addLog("Heartbeat sent at ${System.currentTimeMillis()}")
                    updateStatus(true)
                } else {
                    addLog("Heartbeat failed: ${response.code()}")
                    updateStatus(false)
                }
            } catch (e: Exception) {
                addLog("Heartbeat error: ${e.message}")
                updateStatus(false)
            }
        }
    }

    private fun updateStatus(online: Boolean) {
        if (online) {
            statusText.text = "CONNECTED"
            statusIndicator.setBackgroundColor(getColor(android.R.color.holo_green_dark))
        } else {
            statusText.text = "OFFLINE"
            statusIndicator.setBackgroundColor(getColor(android.R.color.holo_red_dark))
        }
    }

    private fun addLog(message: String) {
        logText.append("\n> $message")
        // Keep logs from getting too long
        if (logText.text.length > 2000) {
            logText.text = logText.text.substring(logText.text.length - 1000)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        heartbeatHandler.removeCallbacks(heartbeatRunnable)
    }
}
