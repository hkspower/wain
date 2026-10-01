# Kept from R8's shrinking in release builds (build.gradle.kts says why).
#
# WebRTC and LiveKit are called through JNI from native code and by
# reflection; R8 sees no Java caller and would remove or rename them, and the
# first sign would be a call that connects and carries no audio.
-keep class org.webrtc.** { *; }
-keep class io.livekit.** { *; }
-keep class com.cloudwebrtc.webrtc.** { *; }
-dontwarn org.webrtc.**

# The call's foreground service is started by name from the manifest.
-keep class com.wainkw.wain.CallService { *; }
