package com.kinora.tv

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject

/**
 * ExoPlayer driven by the TV UI's `PlayerCommand`s (packages/shared/src/playerBridge.ts), which the shell
 * passes on; state goes back as `PlayerReport`s. Mirrors the shell's AVPlay controller: every `load`
 * starts a session, and commands for an older session are ignored.
 *
 * Durations travel as seconds, null while unknown, or "live" while the stream grows (a transcode's
 * EVENT playlist before its end); the shell turns them into NaN and Infinity.
 */
@OptIn(UnstableApi::class)
class NativePlayer(
    private val context: Context,
    private val view: PlayerView,
    private val send: (JSONObject) -> Unit,
) : Player.Listener {
    private val handler = Handler(Looper.getMainLooper())
    private var exo: ExoPlayer? = null
    private var session = -1
    private var open = false
    private var readySent = false
    private var opened = 0L
    private var lastTracks = ""
    private var lastBuffering: Int? = null

    private val ticker = object : Runnable {
        override fun run() {
            if (!open) return
            tick()
            handler.postDelayed(this, TIME_REPORT_MS)
        }
    }

    private fun player(): ExoPlayer = exo ?: build().also {
        exo = it
        view.player = it
    }

    private fun build(): ExoPlayer {
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent("Kinora Android TV/${BuildConfig.VERSION_NAME}")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
        // Constant-bitrate seeking: files without an index (some MPEG-TS, AVI, MP3) can still seek.
        val extractors = DefaultExtractorsFactory().setConstantBitrateSeekingEnabled(true)
        val renderers = DefaultRenderersFactory(context).setEnableDecoderFallback(true)
        val audio = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build()
        return ExoPlayer.Builder(context, renderers)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http, extractors))
            .setTrackSelector(DefaultTrackSelector(context))
            .setAudioAttributes(audio, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
            .apply {
                addListener(this@NativePlayer)
                // Kinora draws text subtitles itself (SubtitleOverlay in the UI).
                trackSelectionParameters = trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build()
            }
    }

    /** A command from the shell, as JSON text. Main thread. */
    fun handle(json: String) {
        val command = try {
            JSONObject(json)
        } catch (_: Exception) {
            return
        }
        val name = command.optString("command")
        if (name == "load") {
            val url = command.optString("url")
            if (!url.startsWith("http://") && !url.startsWith("https://")) return
            load(command.optInt("session"), command.optString("kind"), url, command.optDouble("start", 0.0))
            return
        }
        if (command.optInt("session", -2) != session || !open) return
        val player = exo ?: return
        when (name) {
            "unload" -> close()
            "play" -> {
                if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
                player.playWhenReady = true
            }
            "pause" -> player.playWhenReady = false
            "seek" -> {
                val seconds = command.optDouble("seconds", Double.NaN)
                if (!seconds.isNaN()) player.seekTo((seconds.coerceAtLeast(0.0) * 1000).toLong())
            }
            "audio" -> selectAudio(command.optString("id"))
        }
    }

    private fun load(next: Int, kind: String, url: String, start: Double) {
        close()
        session = next
        open = true
        readySent = false
        lastTracks = ""
        lastBuffering = null
        opened = SystemClock.elapsedRealtime()
        log("open $kind ${url.replace(Regex("token=[^&]+"), "token=…")}")
        val item = MediaItem.Builder().setUri(url).apply { if (kind == "hls") setMimeType(MimeTypes.APPLICATION_M3U8) }.build()
        val player = player()
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO).build()
        // An explicit start: a transcode's EVENT playlist counts as live, and would otherwise open at its live edge.
        player.setMediaItem(item, (start.coerceAtLeast(0.0) * 1000).toLong())
        player.playWhenReady = false
        view.visibility = View.VISIBLE
        player.prepare()
        handler.removeCallbacks(ticker)
        handler.postDelayed(ticker, TIME_REPORT_MS)
    }

    private fun close() {
        if (!open) return
        open = false
        handler.removeCallbacks(ticker)
        log("close")
        exo?.let {
            it.stop()
            it.clearMediaItems()
        }
        view.keepScreenOn = false
        view.visibility = View.GONE
    }

    /** The shell left the UI (offline, pairing, server list) or the app is closing. */
    fun stop() = close()

    /** The app went to the background: pause, and keep the source for when it returns. */
    fun background() {
        if (open) exo?.playWhenReady = false
    }

    fun release() {
        close()
        handler.removeCallbacksAndMessages(null)
        view.player = null
        exo?.release()
        exo = null
    }

    // ------------------------------------------------------------ reports

    private fun report(event: String, fill: JSONObject.() -> Unit = {}) {
        send(JSONObject().put("event", event).put("session", session).apply(fill))
    }

    private fun log(message: String) {
        val seconds = (SystemClock.elapsedRealtime() - opened) / 1000.0
        report("log") { put("message", "[%.1fs] %s".format(seconds, message)) }
    }

    private fun duration(player: ExoPlayer): Any {
        if (player.isCurrentMediaItemDynamic || player.isCurrentMediaItemLive) return "live"
        val milliseconds = player.duration
        return if (milliseconds == C.TIME_UNSET || milliseconds < 0) JSONObject.NULL else milliseconds / 1000.0
    }

    private fun tick() {
        val player = exo ?: return
        if (readySent) {
            report("time") {
                put("time", player.currentPosition.coerceAtLeast(0) / 1000.0)
                put("duration", duration(player))
            }
        }
        if (player.playbackState == Player.STATE_BUFFERING) reportBuffering(bufferPercent(player))
    }

    /** How far the start (or rebuffer) threshold is filled: ExoPlayer itself has no percentage. */
    private fun bufferPercent(player: ExoPlayer) = (player.totalBufferedDuration * 100 / BUFFER_TARGET_MS).toInt().coerceIn(0, 99)

    private fun reportBuffering(percent: Int?) {
        if (percent == lastBuffering) return
        lastBuffering = percent
        report("buffering") { put("percent", percent ?: JSONObject.NULL) }
    }

    private fun reportTracks() {
        val player = exo ?: return
        val tracks = JSONArray()
        player.currentTracks.groups.forEachIndexed { group, info ->
            if (info.type != C.TRACK_TYPE_AUDIO) return@forEachIndexed
            for (track in 0 until info.length) {
                if (!info.isTrackSupported(track)) continue
                val format = info.getTrackFormat(track)
                val language = format.language?.takeIf { it.isNotBlank() && it != "und" }
                tracks.put(
                    JSONObject()
                        .put("id", "$group:$track")
                        .put("language", language ?: JSONObject.NULL)
                        .put("label", audioLabel(format, language, tracks.length() + 1))
                        .put("enabled", info.isTrackSelected(track)),
                )
            }
        }
        val text = tracks.toString()
        if (text == lastTracks) return
        lastTracks = text
        report("tracks") { put("tracks", tracks) }
    }

    private fun selectAudio(id: String) {
        val player = exo ?: return
        val parts = id.split(":").mapNotNull { it.toIntOrNull() }
        if (parts.size != 2) return
        val group = player.currentTracks.groups.getOrNull(parts[0]) ?: return
        if (group.type != C.TRACK_TYPE_AUDIO || parts[1] !in 0 until group.length) return
        player.trackSelectionParameters = player.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, parts[1]))
            .build()
    }

    // ------------------------------------------------------------ ExoPlayer events

    override fun onPlaybackStateChanged(state: Int) {
        val player = exo ?: return
        if (!open) return
        when (state) {
            Player.STATE_BUFFERING -> reportBuffering(bufferPercent(player))
            Player.STATE_READY -> {
                if (!readySent) {
                    readySent = true
                    log("ready, duration ${duration(player)}")
                    report("ready") { put("duration", duration(player)) }
                    reportTracks()
                }
                reportBuffering(null)
            }
            Player.STATE_ENDED -> {
                report("ended")
                close()
            }
            Player.STATE_IDLE -> Unit
        }
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
        if (!open) return
        view.keepScreenOn = isPlaying
        if (isPlaying) report("playing")
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        if (open && !playWhenReady) report("paused")
    }

    override fun onTracksChanged(tracks: Tracks) {
        if (open && readySent) reportTracks()
    }

    override fun onRenderedFirstFrame() {
        if (open) log("first frame")
    }

    override fun onVideoSizeChanged(videoSize: VideoSize) {
        if (open && videoSize.width > 0) log("video ${videoSize.width}×${videoSize.height}")
    }

    override fun onPlayerError(error: PlaybackException) {
        val player = exo ?: return
        if (!open) return
        log("error ${error.errorCodeName}: ${error.message}${error.cause?.let { " (${it.javaClass.simpleName}: ${it.message})" } ?: ""}")
        if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
            player.seekToDefaultPosition()
            player.prepare()
            return
        }
        report("error") { put("code", error.errorCodeName) }
    }

    private companion object {
        const val TIME_REPORT_MS = 250L
        /** ExoPlayer's default start and rebuffer thresholds lie around here (1–2 s of media). */
        const val BUFFER_TARGET_MS = 2_000L

        private val CODECS = mapOf(
            MimeTypes.AUDIO_AC3 to "AC-3",
            MimeTypes.AUDIO_E_AC3 to "E-AC-3",
            MimeTypes.AUDIO_E_AC3_JOC to "E-AC-3 Atmos",
            MimeTypes.AUDIO_AAC to "AAC",
            MimeTypes.AUDIO_MPEG to "MP3",
            MimeTypes.AUDIO_OPUS to "Opus",
            MimeTypes.AUDIO_VORBIS to "Vorbis",
            MimeTypes.AUDIO_FLAC to "FLAC",
            MimeTypes.AUDIO_DTS to "DTS",
            MimeTypes.AUDIO_DTS_HD to "DTS-HD",
            MimeTypes.AUDIO_DTS_EXPRESS to "DTS Express",
            MimeTypes.AUDIO_TRUEHD to "TrueHD",
            MimeTypes.AUDIO_RAW to "PCM",
        )

        /** "eng · E-AC-3 5.1", like the AVPlay labels; the track's own title, when it has one, goes in the middle. */
        fun audioLabel(format: Format, language: String?, position: Int): String {
            val codec = CODECS[format.sampleMimeType]
            val channels = when (format.channelCount) {
                1 -> "1.0"
                2 -> "2.0"
                6 -> "5.1"
                8 -> "7.1"
                else -> null
            }
            val detail = listOfNotNull(codec, channels).joinToString(" ").ifEmpty { null }
            val title = format.label?.takeIf { it.isNotBlank() && it != language }
            val parts = listOfNotNull(language, title, detail)
            return if (parts.isEmpty()) position.toString() else parts.joinToString(" · ")
        }
    }
}
