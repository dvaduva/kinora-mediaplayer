package com.kinora.tv

import android.content.Context
import android.hardware.display.DisplayManager
import android.media.MediaCodecInfo
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaCodecList
import android.os.Build
import android.view.Display
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.AudioCapabilities
import org.json.JSONArray
import org.json.JSONObject

/**
 * What ExoPlayer plays on this device, as a Kinora `CapabilityProfile` (packages/shared/src/capabilities.ts).
 *
 * Containers are ExoPlayer's own extractors, the same on every device. Codecs come from the device:
 * video from the hardware decoders in MediaCodecList (a software HEVC or AV1 decoder cannot keep up
 * with a film), audio from its decoders plus what the HDMI sink takes as passthrough (AC-3, E-AC-3,
 * DTS to a receiver, which ExoPlayer cannot decode by itself). 4K needs a 4K decoder and a 4K display
 * mode; HDR comes from the display. TrueHD is dropped on the server (`applyPlatformQuirks`).
 */
@OptIn(UnstableApi::class)
object Capabilities {
    private const val HEVC = "video/hevc"
    private const val AVC = "video/avc"
    private const val VP9 = "video/x-vnd.on2.vp9"
    private const val AV1 = "video/av01"
    private const val DOLBY_VISION = "video/dolby-vision"

    fun profile(context: Context): JSONObject {
        val decoders = try {
            MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        } catch (_: Exception) {
            emptyList()
        }
        fun all(mime: String) = decoders.filter { info -> info.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
        fun hardware(mime: String) = all(mime).filter(::isHardware)
        fun hasProfile(infos: List<MediaCodecInfo>, mime: String, vararg profiles: Int) =
            infos.any { info -> capabilitiesOf(info, mime)?.profileLevels?.any { it.profile in profiles } == true }

        val video = JSONArray()
        val avc = hardware(AVC).ifEmpty { all(AVC) }
        video.put(codec("h264", if (hasProfile(avc, AVC, CodecProfileLevel.AVCProfileHigh10)) 10 else 8))
        val hevc = hardware(HEVC)
        val hevc10 = hasProfile(hevc, HEVC, CodecProfileLevel.HEVCProfileMain10) ||
            (Build.VERSION.SDK_INT >= 24 && hasProfile(hevc, HEVC, CodecProfileLevel.HEVCProfileMain10HDR10))
        if (hevc.isNotEmpty()) video.put(codec("hevc", if (hevc10) 10 else 8))
        val vp9 = hardware(VP9)
        if (vp9.isNotEmpty()) video.put(codec("vp9", if (Build.VERSION.SDK_INT >= 24 && hasProfile(vp9, VP9, CodecProfileLevel.VP9Profile2)) 10 else 8))
        val av1 = hardware(AV1)
        if (av1.isNotEmpty()) video.put(codec("av1", if (Build.VERSION.SDK_INT >= 29 && hasProfile(av1, AV1, CodecProfileLevel.AV1ProfileMain10)) 10 else 8))
        if (all("video/mpeg2").isNotEmpty()) video.put(JSONObject().put("codec", "mpeg2"))
        if (all("video/mp4v-es").isNotEmpty()) video.put(JSONObject().put("codec", "mpeg4"))

        // What the HDMI sink (TV or receiver) takes as a bitstream. Deprecated in Media3 1.11 for an overload that also
        // takes a list of encodings; this one still answers the question asked here.
        @Suppress("DEPRECATION")
        val passthrough = try {
            AudioCapabilities.getCapabilities(context, AudioAttributes.DEFAULT, null)
        } catch (_: Exception) {
            null
        }
        fun passes(encoding: Int) = passthrough?.supportsEncoding(encoding) == true
        fun decodes(mime: String) = all(mime).isNotEmpty()
        fun channels(mime: String, fallback: Int) =
            all(mime).mapNotNull { capabilitiesOf(it, mime)?.audioCapabilities?.maxInputChannelCount }.maxOrNull()?.coerceIn(2, 8) ?: fallback

        val audio = JSONArray()
        val hlsAudio = mutableListOf("aac", "mp3")
        audio.put(audioCodec("aac", channels("audio/mp4a-latm", 6)))
        audio.put(audioCodec("mp3", 2))
        audio.put(audioCodec("pcm", 8))
        if (decodes("audio/ac3") || passes(C.ENCODING_AC3)) {
            audio.put(audioCodec("ac3", 6))
            hlsAudio.add("ac3")
        }
        if (decodes("audio/eac3") || passes(C.ENCODING_E_AC3) || passes(C.ENCODING_E_AC3_JOC)) {
            audio.put(audioCodec("eac3", 8))
            hlsAudio.add("eac3")
        }
        if (decodes("audio/vnd.dts") || passes(C.ENCODING_DTS)) audio.put(audioCodec("dts", 6))
        if (decodes("audio/flac")) audio.put(audioCodec("flac", 8))
        if (decodes("audio/opus")) audio.put(audioCodec("opus", 8))
        if (decodes("audio/vorbis")) audio.put(audioCodec("vorbis", 8))

        val webm = JSONArray()
        if (vp9.isNotEmpty()) webm.put("vp9")
        if (av1.isNotEmpty()) webm.put("av1")
        val containers = JSONArray()
            .put(JSONObject().put("names", JSONArray(listOf("mp4", "m4v", "mov"))))
            .put(JSONObject().put("names", JSONArray(listOf("mkv"))))
            .put(JSONObject().put("names", JSONArray(listOf("ts", "m2ts"))))
            .put(
                JSONObject().put("names", JSONArray(listOf("avi")))
                    .put("video", JSONArray(listOf("h264", "mpeg4")))
                    .put("audio", JSONArray(listOf("mp3", "ac3", "aac", "pcm"))),
            )
        if (webm.length() > 0) {
            containers.put(JSONObject().put("names", JSONArray(listOf("webm"))).put("video", webm).put("audio", JSONArray(listOf("opus", "vorbis"))))
        }

        val display = context.getSystemService(DisplayManager::class.java)?.getDisplay(Display.DEFAULT_DISPLAY)
        val panel = display?.supportedModes?.maxOfOrNull { maxOf(it.physicalWidth, it.physicalHeight) }
        val decodes4k = (hevc + avc).any { capabilitiesOf(it, if (it in hevc) HEVC else AVC)?.videoCapabilities?.isSizeSupported(3840, 2160) == true }
        val uhd = decodes4k && (panel == null || panel >= 3840)

        val hdr = JSONArray()
        if (hevc10 && display != null && Build.VERSION.SDK_INT >= 24) {
            @Suppress("DEPRECATION")
            val types = display.hdrCapabilities?.supportedHdrTypes ?: IntArray(0)
            if (Display.HdrCapabilities.HDR_TYPE_HDR10 in types) hdr.put("hdr10")
            if (Display.HdrCapabilities.HDR_TYPE_HLG in types) hdr.put("hlg")
            if (Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in types && hardware(DOLBY_VISION).isNotEmpty()) hdr.put("dolby_vision")
        }

        // ExoPlayer plays HLS itself: MPEG-TS segments may carry HEVC and Dolby audio, unlike hls.js in a browser.
        val hlsVideo = JSONArray().put("h264")
        if (hevc.isNotEmpty()) hlsVideo.put("hevc")

        return JSONObject()
            .put("version", 1)
            .put("containers", containers)
            .put("video", video)
            .put("audio", audio)
            .put("hdr", hdr)
            .put("maxWidth", if (uhd) 3840 else 1920)
            .put("maxHeight", if (uhd) 2160 else 1080)
            .put("maxBitrate", JSONObject.NULL)
            .put("hls", JSONObject().put("video", hlsVideo).put("audio", JSONArray(hlsAudio)))
            .put("subtitles", "overlay")
            .put("player", "exoplayer")
    }

    private fun codec(name: String, bitDepth: Int) = JSONObject().put("codec", name).put("maxBitDepth", bitDepth)

    private fun audioCodec(name: String, channels: Int) = JSONObject().put("codec", name).put("maxChannels", channels)

    private fun capabilitiesOf(info: MediaCodecInfo, mime: String): MediaCodecInfo.CodecCapabilities? = try {
        info.getCapabilitiesForType(mime)
    } catch (_: Exception) {
        null
    }

    private fun isHardware(info: MediaCodecInfo): Boolean {
        if (Build.VERSION.SDK_INT >= 29) return info.isHardwareAccelerated
        val name = info.name.lowercase()
        return !(name.startsWith("omx.google.") || name.startsWith("c2.android.") || name.startsWith("c2.google.") || name.contains(".sw.") || name.contains("ffmpeg"))
    }
}
