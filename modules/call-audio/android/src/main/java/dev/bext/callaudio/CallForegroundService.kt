// SPDX-License-Identifier: Elastic-2.0
package dev.bext.callaudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * A visible, ongoing notification for the length of one call. Android
 * requires it for microphone use while the app is not in the foreground, and
 * it is the operator's standing reminder that the microphone is live.
 *
 * The notification carries no agent name, transcript or session content.
 */
class CallForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Calls", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    val notification =
      builder
        .setContentTitle("Automonique")
        .setContentText("Call in progress. The microphone is on.")
        .setSmallIcon(applicationInfo.icon)
        .setOngoing(true)
        .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION, notification)
    }
    // If the process is killed the call is over; do not restart without it.
    return START_NOT_STICKY
  }

  private companion object {
    const val CHANNEL = "automonique-call"
    const val NOTIFICATION = 0x0CA11
  }
}
