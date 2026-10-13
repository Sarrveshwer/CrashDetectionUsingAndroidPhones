package com.example.crashdetection.api

import android.content.Context

/** Stores the Node.js API address so a physical phone can connect to the computer on its LAN. */
object ServerConfig {
    private const val PREFS = "crash_detection_network"
    private const val KEY_BASE_URL = "base_url"
    private const val EMULATOR_URL = "http://10.0.2.2:5001/api/"

    fun baseUrl(context: Context): String = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_BASE_URL, EMULATOR_URL) ?: EMULATOR_URL

    fun saveBaseUrl(context: Context, value: String) {
        val trimmed = value.trim().let { if (it.endsWith("/")) it else "$it/" }
        require(trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            "Server URL must start with http:// or https://"
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_BASE_URL, if (trimmed.endsWith("/api/")) trimmed else trimmed.trimEnd('/') + "/api/")
            .apply()
    }
}
