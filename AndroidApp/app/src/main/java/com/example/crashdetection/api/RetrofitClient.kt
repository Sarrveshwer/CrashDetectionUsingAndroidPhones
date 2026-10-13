package com.example.crashdetection.api

import android.content.Context
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object RetrofitClient {
    @Volatile private var cachedUrl: String? = null
    @Volatile private var cachedService: ApiService? = null

    fun service(context: Context): ApiService {
        val url = ServerConfig.baseUrl(context.applicationContext)
        if (cachedService == null || cachedUrl != url) {
            synchronized(this) {
                if (cachedService == null || cachedUrl != url) {
                    val client = OkHttpClient.Builder()
                        .connectTimeout(5, TimeUnit.SECONDS)
                        .readTimeout(10, TimeUnit.SECONDS)
                        .writeTimeout(15, TimeUnit.SECONDS)
                        .build()
                    cachedService = Retrofit.Builder()
                        .baseUrl(url)
                        .client(client)
                        .addConverterFactory(GsonConverterFactory.create())
                        .build()
                        .create(ApiService::class.java)
                    cachedUrl = url
                }
            }
        }
        return cachedService!!
    }
}
