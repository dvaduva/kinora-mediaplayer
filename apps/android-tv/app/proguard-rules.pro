# The shell calls these through addJavascriptInterface; R8 must keep them by name.
-keepclassmembers class com.kinora.tv.ShellBridge {
    @android.webkit.JavascriptInterface <methods>;
}
