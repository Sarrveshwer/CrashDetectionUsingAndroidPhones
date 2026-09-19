package com.example.crashdetection.api

import com.example.crashdetection.models.*
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
}
