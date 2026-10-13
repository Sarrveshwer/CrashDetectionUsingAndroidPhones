package com.example.crashdetection.models

data class EdgeDeviceRegistration(
    val deviceId: String,
    val deviceName: String,
    val deviceModel: String,
    val androidVersion: String,
    val appVersion: String,
    val ipAddress: String? = null,
    val cameraId: String? = null
)

data class HeartbeatRequest(
    val status: String = "ONLINE",
    val latitude: Double? = null,
    val longitude: Double? = null
)

data class RegisteredCamera(
    val _id: String,
    val cameraId: String,
    val cameraName: String,
    val location: String,
    val latitude: Double,
    val longitude: Double,
    val status: String
)

data class EdgeDeviceResponse(
    val _id: String,
    val deviceId: String,
    val deviceName: String,
    val status: String,
    val lastHeartbeat: String,
    val camera: RegisteredCamera? = null
)

data class CameraUpdateRequest(
    val cameraName: String
)
