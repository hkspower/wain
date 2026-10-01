package com.wainkw.wain

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps شوق's call alive while the app is not in front.
 *
 * Android cuts the microphone of a backgrounded app unless a foreground
 * service of type `microphone` is running, and requires a notification while
 * it does. This is that service and nothing else: it holds no audio itself —
 * LiveKit does — it only tells the system the app is in a call. Started and
 * stopped from Dart (`lib/ai/keep_alive.dart`) over `wain/call_keepalive`.
 *
 * Written here rather than taken from a plugin because the obvious plugin
 * registers an iOS background-fetch task at every launch, which this app has
 * no use for.
 */
class CallService : Service() {
    companion object {
        const val CHANNEL_ID = "wain_call"
        const val NOTIFICATION_ID = 7301
        const val ACTION_HANG_UP = "com.wainkw.wain.HANG_UP"

        @Volatile
        var running = false
            private set

        /** Set by MainActivity: the notification's «إنهاء» reaches Dart. */
        @Volatile
        var onHangUp: (() -> Unit)? = null

        fun start(context: Context, title: String, text: String, hangUp: String) {
            val i = Intent(context, CallService::class.java)
                .putExtra("title", title)
                .putExtra("text", text)
                .putExtra("hangUp", hangUp)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(i)
            } else {
                context.startService(i)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HANG_UP) {
            onHangUp?.invoke()
            stopSelf()
            return START_NOT_STICKY
        }
        val title = intent?.getStringExtra("title") ?: "وين"
        val text = intent?.getStringExtra("text") ?: ""
        val hangUp = intent?.getStringExtra("hangUp") ?: "إنهاء"
        val notification = build(title, text, hangUp)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        running = true
        // Not sticky: a call cannot be resumed by restarting a service, and a
        // notification claiming one is live after the app died would be a lie.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    /** Swiping the app away ends the call; the notification must go with it. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        onHangUp?.invoke()
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    private fun build(title: String, text: String, hangUp: String): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            manager.getNotificationChannel(CHANNEL_ID) == null
        ) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "مكالمة شوق", NotificationManager.IMPORTANCE_LOW)
                    .apply { setShowBadge(false) },
            )
        }
        val immutable =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_UPDATE_CURRENT or immutable,
        )
        val end = PendingIntent.getService(
            this, 1,
            Intent(this, CallService::class.java).setAction(ACTION_HANG_UP),
            PendingIntent.FLAG_UPDATE_CURRENT or immutable,
        )
        @Suppress("DEPRECATION")
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        return b.setSmallIcon(R.drawable.ic_call_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_CALL)
            .addAction(
                Notification.Action.Builder(null, hangUp, end).build(),
            )
            .build()
    }
}
