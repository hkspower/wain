package com.wainkw.wain

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "wain/call_keepalive")
        // The notification's «إنهاء» hangs the call up in Dart, where the call is.
        CallService.onHangUp = { runOnUiThread { channel.invokeMethod("hangUp", null) } }
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "start" -> {
                    CallService.start(
                        this,
                        call.argument<String>("title") ?: "وين",
                        call.argument<String>("text") ?: "",
                        call.argument<String>("hangUp") ?: "إنهاء",
                    )
                    result.success(true)
                }
                "stop" -> {
                    CallService.stop(this)
                    result.success(true)
                }
                "isRunning" -> result.success(CallService.running)
                else -> result.notImplemented()
            }
        }
    }

    override fun onDestroy() {
        CallService.onHangUp = null
        super.onDestroy()
    }
}
