package com.beaconsecureview.camera

import android.os.Build
import android.os.PowerManager

/**
 * The phone's thermal state for the heartbeat (ADR 0093), so Beacon can warn
 * when a camera is overheating before Android throttles or shuts it down.
 * Names match the backend's `thermalStatus` values.
 */
internal object ThermalStatus {
    /** Maps `PowerManager.THERMAL_STATUS_*` (0..6) to the wire value, or null if unknown. */
    fun wireValue(status: Int): String? =
        when (status) {
            0 -> "none"
            1 -> "light"
            2 -> "moderate"
            3 -> "severe"
            4 -> "critical"
            5 -> "emergency"
            6 -> "shutdown"
            else -> null
        }

    /** The current status. Android reports it from 10 (API 29); older phones send nothing. */
    fun current(powerManager: PowerManager?): String? {
        if (powerManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return runCatching { wireValue(powerManager.currentThermalStatus) }.getOrNull()
    }
}
