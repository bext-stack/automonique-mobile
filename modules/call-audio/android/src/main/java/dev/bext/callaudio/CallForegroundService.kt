// SPDX-License-Identifier: Elastic-2.0
package dev.bext.callaudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * The system's view of one call: an ongoing notification with the agent's
 * name, a running duration and a hang-up button, visible in other apps and
 * on the lock screen. Android also requires it for microphone use while the
 * app is not in the foreground.
 *
 * It shows who is being called and for how long, never what is said.
 */
class CallForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_HANG_UP) {
      // The module ends the call and stops this service.
      hangUpRequested?.invoke()
      return START_NOT_STICKY
    }
    val name = intent?.getStringExtra(EXTRA_NAME)?.take(MAX_NAME)?.ifBlank { null } ?: "Automonique"
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Calls", NotificationManager.IMPORTANCE_LOW).apply {
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        },
      )
    }
    val immutable =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
    val hangUp =
      PendingIntent.getService(
        this,
        1,
        Intent(this, CallForegroundService::class.java).setAction(ACTION_HANG_UP),
        PendingIntent.FLAG_UPDATE_CURRENT or immutable,
      )
    val open =
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        PendingIntent.getActivity(this, 2, it, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
      }
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(this, CHANNEL)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(this)
      }
    builder
      .setContentTitle(name)
      .setContentText("Call in progress. The microphone is on.")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_CALL)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setWhen(System.currentTimeMillis())
      .setShowWhen(true)
      .setUsesChronometer(true)
    if (open != null) builder.setContentIntent(open)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val person = Person.Builder().setName(name).setImportant(true).build()
      builder.setStyle(Notification.CallStyle.forOngoingCall(person, hangUp))
    } else {
      @Suppress("DEPRECATION")
      builder.addAction(Notification.Action.Builder(null, "Hang up", hangUp).build())
    }
    val notification = builder.build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION, notification)
    }
    // If the process is killed the call is over; do not restart without it.
    return START_NOT_STICKY
  }

  companion object {
    const val EXTRA_NAME = "name"
    const val ACTION_HANG_UP = "dev.bext.callaudio.HANG_UP"
    private const val MAX_NAME = 80
    private const val CHANNEL = "automonique-call"
    private const val NOTIFICATION = 0x0CA11

    /** Set by the module for the length of a call. */
    @Volatile var hangUpRequested: (() -> Unit)? = null
  }
}
