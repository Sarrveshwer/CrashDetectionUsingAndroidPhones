package com.example.crashdetection.utils

import android.content.Context
import android.provider.Settings
import android.os.Build
import android.content.pm.PackageManager

object DeviceUtils {
    fun getDeviceId(context: Context): String {
        return Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "UNKNOWN_DEVICE"
    }

    fun getDeviceName(): String {
        return "${Build.MANUFACTURER} ${Build.MODEL}"
    }

    fun getAndroidVersion(): String {
        return Build.VERSION.RELEASE
    }

    fun getAppVersion(context: Context): String {
        return try {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            packageInfo.versionName ?: "1.0"
        } catch (e: Exception) {
            "1.0"
        }
    }
}
