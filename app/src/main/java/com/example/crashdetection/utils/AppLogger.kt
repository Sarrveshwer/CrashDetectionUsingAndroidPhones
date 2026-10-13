package com.example.crashdetection.utils

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

object AppLogger {
    private const val TAG = "CrashDetectionLog"
    private const val LOG_FILE_NAME = "error_log.txt"

    fun logError(context: Context, message: String, throwable: Throwable? = null) {
        val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())
        val logEntry = "[$timestamp] ERROR: $message\n${throwable?.stackTraceToString() ?: ""}\n"
        
        Log.e(TAG, logEntry)
        
        try {
            val logDir = context.getExternalFilesDir("logs") ?: return
            val logFile = File(logDir, LOG_FILE_NAME)
            if (!logFile.parentFile.exists()) logFile.parentFile.mkdirs()
            logFile.appendText(logEntry)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write to log file", e)
        }
    }

    fun logInfo(context: Context, message: String) {
        val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date())
        val logEntry = "[$timestamp] INFO: $message\n"
        
        Log.i(TAG, logEntry)
        
        try {
            val logDir = context.getExternalFilesDir("logs") ?: return
            val logFile = File(logDir, LOG_FILE_NAME)
            if (!logFile.parentFile.exists()) logFile.parentFile.mkdirs()
            logFile.appendText(logEntry)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write to log file", e)
        }
    }
}
