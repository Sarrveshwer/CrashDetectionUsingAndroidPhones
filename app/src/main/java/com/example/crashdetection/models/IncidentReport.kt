package com.example.crashdetection.models

data class IncidentReport(
    val cameraId: String?,
    val edgeDeviceId: String,
    val cameraName: String?,
    val timestamp: Long,
    val latitude: Double?,
    val longitude: Double?,
    val confidence: Float,
    val snapshotImage: String, // Base64
    val vehicleCount: Int,
    val incidentType: String
)
