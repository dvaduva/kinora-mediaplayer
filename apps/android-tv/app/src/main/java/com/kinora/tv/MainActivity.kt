package com.kinora.tv

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.security.SecureRandom

/**
 * Kinora on Android TV and Fire TV: a WebView runs the same TV shell as the Tizen and webOS packages
 * (from the app's assets), which loads the TV UI from the server in a frame. Films play in ExoPlayer,
 * drawn on a surface under the WebView; the page turns transparent while a source is loaded.
 *
 * Remote keys: D-pad and Enter go to the WebView as they are. Back becomes Escape for the page (the
 * UI goes back, and from Home asks before leaving). Media and channel keys are taken here and handed
 * to the shell, which passes them to the UI: not every WebView turns them into DOM keys.
 */
@OptIn(UnstableApi::class)
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var playerView: PlayerView
    lateinit var player: NativePlayer
        private set
    lateinit var discovery: ServerDiscovery
        private set
    private var destroyed = false

    /** Proves a bridge call comes from the shell's page, not from the UI's frame (which sees the interface too). */
    private val nonce: String = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        playerView = PlayerView(this).apply {
            useController = false
            isFocusable = false
            descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.BLACK)
            // Kinora draws text subtitles itself, over the video, the same on every platform.
            subtitleView?.visibility = View.GONE
            // Shown only while a source is loaded (NativePlayer), so its surface never sits under an idle page.
            visibility = View.GONE
        }
        webView = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isFocusable = true
            isFocusableInTouchMode = true
        }
        root.addView(playerView, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(webView, FrameLayout.LayoutParams(MATCH, MATCH))
        setContentView(root)

        player = NativePlayer(this, playerView, ::send)
        discovery = ServerDiscovery(this)
        configureWebView()
        webView.loadUrl("${SHELL_URL}#nonce=$nonce")
        webView.requestFocus()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun configureWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // The UI's <video> (Live TV, through hls.js) starts without a tap.
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            userAgentString = "$userAgentString KinoraAndroidTV/${BuildConfig.VERSION_NAME}"
        }
        // The shell is served from the assets on a real http origin, so its storage (known servers, tokens) persists.
        val assets = WebViewAssetLoader.Builder()
            .setHttpAllowed(true)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                // The renderer crashed or was killed for memory: start over rather than take the app down.
                Log.w(TAG, "WebView renderer gone (crash: ${Build.VERSION.SDK_INT >= 26 && detail.didCrash()})")
                recreate()
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            // Without this, an idle <video> shows WebView's grey play-button poster.
            override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)

            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (BuildConfig.DEBUG) Log.d(TAG, "${message.messageLevel()} ${message.sourceId()}:${message.lineNumber()} ${message.message()}")
                return true
            }
        }
        webView.addJavascriptInterface(ShellBridge(this, nonce), "KinoraAndroid")
    }

    /** Native → shell: a player report or a key, as JSON text (see apps/tv-shell/src/android.ts). */
    fun send(message: JSONObject) {
        val text = JSONObject.quote(message.toString())
        runOnUiThread {
            if (!destroyed) webView.evaluateJavascript("window.kinoraNative&&window.kinoraNative.receive($text)", null)
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.repeatCount == 0) forwardAsEscape(event.action)
            return true
        }
        val name = MEDIA_KEYS[event.keyCode] ?: return super.dispatchKeyEvent(event)
        val repeats = event.keyCode in REPEATING_KEYS
        if (event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || repeats)) send(JSONObject().put("key", name))
        return true
    }

    /** Back gestures on a phone (testing without a TV) reach here instead of dispatchKeyEvent. */
    @Deprecated("Back from the remote is handled in dispatchKeyEvent; this covers gesture navigation.")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        forwardAsEscape(KeyEvent.ACTION_DOWN)
        forwardAsEscape(KeyEvent.ACTION_UP)
    }

    private fun forwardAsEscape(action: Int) {
        if (!webView.hasFocus()) webView.requestFocus()
        webView.dispatchKeyEvent(KeyEvent(action, KeyEvent.KEYCODE_ESCAPE))
    }

    fun exit() {
        player.stop()
        finish()
    }

    override fun onStart() {
        super.onStart()
        discovery.start()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onStop() {
        // Home, another app or input: pause the film; the UI shows it paused when the app comes back.
        player.background()
        discovery.stop()
        super.onStop()
    }

    override fun onDestroy() {
        destroyed = true
        player.release()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val TAG = "Kinora"
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val SHELL_URL = "http://appassets.androidplatform.net/assets/shell/index.html"

        /** Remote keys handed to the UI, by their `KeyboardEvent.key` names (`SHELL_KEYS` in @kinora/shared). */
        private val MEDIA_KEYS = mapOf(
            KeyEvent.KEYCODE_MEDIA_PLAY to "MediaPlay",
            KeyEvent.KEYCODE_MEDIA_PAUSE to "MediaPause",
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to "MediaPlayPause",
            KeyEvent.KEYCODE_HEADSETHOOK to "MediaPlayPause",
            KeyEvent.KEYCODE_MEDIA_STOP to "MediaStop",
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to "MediaFastForward",
            KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD to "MediaFastForward",
            KeyEvent.KEYCODE_MEDIA_REWIND to "MediaRewind",
            KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD to "MediaRewind",
            KeyEvent.KEYCODE_MEDIA_NEXT to "MediaTrackNext",
            KeyEvent.KEYCODE_MEDIA_PREVIOUS to "MediaTrackPrevious",
            KeyEvent.KEYCODE_CHANNEL_UP to "ChannelUp",
            KeyEvent.KEYCODE_CHANNEL_DOWN to "ChannelDown",
        )

        /** Held down, these keep acting (seek further, zap on); the others act once per press. */
        private val REPEATING_KEYS = setOf(
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_CHANNEL_UP,
            KeyEvent.KEYCODE_CHANNEL_DOWN,
        )
    }
}
