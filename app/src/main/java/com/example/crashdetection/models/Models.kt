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

data class EdgeDeviceResponse(
    val _id: String,
    val deviceId: String,
    val deviceName: String,
    val status: String,
    val lastHeartbeat: String
)
