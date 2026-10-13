package com.example.crashdetection.api

import com.example.crashdetection.models.*
import okhttp3.MultipartBody
import retrofit2.Response
import retrofit2.http.*

interface ApiService {
    @POST("devices/register")
    suspend fun registerDevice(@Body registration: EdgeDeviceRegistration): Response<EdgeDeviceResponse>

    @POST("devices/{deviceId}/heartbeat")
    suspend fun sendHeartbeat(
        @Path("deviceId") deviceId: String,
        @Body heartbeat: HeartbeatRequest
    ): Response<Unit>

    @POST("incidents/report")
    suspend fun reportIncident(@Body report: IncidentReport): Response<Unit>

    @Multipart
    @POST("incidents/report-video")
    suspend fun reportIncidentWithVideo(
        @Part("report") report: IncidentReport,
        @Part video: MultipartBody.Part
    ): Response<Unit>

    @PUT("cameras/{id}")
    suspend fun updateCamera(
        @Path("id") id: String,
        @Body request: CameraUpdateRequest
    ): Response<RegisteredCamera>
}
