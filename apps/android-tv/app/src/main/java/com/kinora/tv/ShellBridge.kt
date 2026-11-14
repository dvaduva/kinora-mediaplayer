package com.kinora.tv

import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import org.json.JSONArray
import java.net.Inet4Address
import java.security.MessageDigest

/**
 * What the shell's page may ask the app (`window.KinoraAndroid`; see apps/tv-shell/src/android.ts).
 * The interface is visible to every frame, the UI's too, so each call must carry the nonce the
 * activity put in the shell's hash. Calls arrive on WebView's JavaBridge thread.
 */
class ShellBridge(private val activity: MainActivity, nonce: String) {
    private val expected = nonce.toByteArray()

    private fun allowed(nonce: String) = MessageDigest.isEqual(expected, nonce.toByteArray())

    @JavascriptInterface
    fun command(nonce: String, json: String) {
        if (!allowed(nonce)) return
        activity.runOnUiThread { activity.player.handle(json) }
    }

    @JavascriptInterface
    fun capabilities(nonce: String): String = if (allowed(nonce)) Capabilities.profile(activity).toString() else ""

    @JavascriptInterface
    fun servers(nonce: String): String = if (allowed(nonce)) JSONArray(activity.discovery.servers()).toString() else "[]"

    @JavascriptInterface
    fun localAddress(nonce: String): String = if (allowed(nonce)) ipv4Address(activity) ?: "" else ""

    @JavascriptInterface
    fun deviceName(nonce: String): String = if (allowed(nonce)) deviceName(activity) else ""

    @JavascriptInterface
    fun exit(nonce: String) {
        if (!allowed(nonce)) return
        activity.runOnUiThread { activity.exit() }
    }

    companion object {
        /** The device's own IPv4 address, for the subnet scan when NSD finds nothing (multicast blocked on the network). */
        fun ipv4Address(context: Context): String? = try {
            val connectivity = context.getSystemService(ConnectivityManager::class.java)
            val links = connectivity.getLinkProperties(connectivity.activeNetwork)
            links?.linkAddresses?.map { it.address }?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
        } catch (_: Exception) {
            null
        }

        /** The name shown in Settings → Devices: the one the user gave the device, else maker and model. */
        fun deviceName(context: Context): String {
            val given = if (Build.VERSION.SDK_INT >= 25) Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME) else null
            if (!given.isNullOrBlank()) return given.trim()
            if (context.packageManager.hasSystemFeature("amazon.hardware.fire_tv")) return "Fire TV ${Build.MODEL}"
            val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
            return if (Build.MODEL.startsWith(maker, ignoreCase = true)) Build.MODEL else "$maker ${Build.MODEL}"
        }
    }
}
