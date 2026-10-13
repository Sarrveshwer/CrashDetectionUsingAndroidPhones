package com.example.crashdetection.api

import android.content.Context
import android.location.Location
import android.os.Build
import com.example.crashdetection.models.CameraUpdateRequest
import com.example.crashdetection.models.EdgeDeviceRegistration
import com.example.crashdetection.models.HeartbeatRequest
import com.example.crashdetection.utils.DeviceUtils

object DeviceConnectionManager {
    private const val PREFS = "crashdet_preferences"
    private const val CAMERA_ID = "camera_mongo_id"
    private const val CAMERA_NAME = "camera_name"

    fun getCameraId(context: Context): String? {
        return context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(CAMERA_ID, null)
    }

    fun getCameraName(context: Context): String {
        return context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(CAMERA_NAME, null) ?: DeviceUtils.getDeviceName() ?: "Android Camera"
    }

    fun setCameraName(context: Context, name: String) {
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(CAMERA_NAME, name)
            .apply()
    }

    suspend fun updateCameraName(context: Context, name: String): Result<Unit> = runCatching {
        val app = context.applicationContext
        setCameraName(app, name)
        val mongoCameraId = getCameraId(app)
        if (!mongoCameraId.isNullOrBlank()) {
            val response = RetrofitClient.service(app).updateCamera(mongoCameraId, CameraUpdateRequest(name))
            check(response.isSuccessful) { "Server camera update failed (HTTP ${response.code()})" }
        }
    }

    suspend fun register(context: Context): Result<Unit> = runCatching {
        val app = context.applicationContext
        val deviceId = DeviceUtils.getDeviceId(app)

        val body = EdgeDeviceRegistration(
            deviceId = deviceId,
            deviceName = DeviceUtils.getDeviceName(),
            deviceModel = Build.MODEL,
            androidVersion = DeviceUtils.getAndroidVersion(),
            appVersion = DeviceUtils.getAppVersion(app)
        )

        val response = RetrofitClient.service(app).registerDevice(body)
        check(response.isSuccessful) {
            "Registration failed (HTTP ${response.code()})"
        }

        val cameraId = response.body()?.camera?._id
        check(!cameraId.isNullOrBlank()) {
            "Registration succeeded, but the server returned no camera ID"
        }

        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(CAMERA_ID, cameraId)
            .apply()

        val savedName = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CAMERA_NAME, null)
        if (!savedName.isNullOrBlank()) {
            runCatching {
                RetrofitClient.service(app).updateCamera(cameraId, CameraUpdateRequest(savedName))
            }
        }
    }

    suspend fun heartbeat(
        context: Context,
        location: Location? = null
    ): Result<Unit> = runCatching {
        val app = context.applicationContext
        val id = DeviceUtils.getDeviceId(app)

        val response = RetrofitClient.service(app).sendHeartbeat(
            id,
            HeartbeatRequest(
                status = "ONLINE",
                latitude = location?.latitude,
                longitude = location?.longitude
            )
        )

        check(response.isSuccessful) {
            "Heartbeat failed (HTTP ${response.code()})"
        }
    }
}
