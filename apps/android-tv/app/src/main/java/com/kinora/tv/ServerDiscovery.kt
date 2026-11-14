package com.kinora.tv

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.util.Log
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap

/**
 * Finds Kinora servers on the LAN through NSD: the server announces `_kinora._tcp` (apps/server/src/mdns.ts).
 * Browsing runs while the activity is started; the shell asks for what was found so far (`servers`).
 * NSD resolves one service at a time, so services wait their turn in a queue.
 */
class ServerDiscovery(context: Context) {
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val found = ConcurrentHashMap<String, String>()
    private val queue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private var listener: NsdManager.DiscoveryListener? = null

    fun servers(): List<String> = found.values.distinct()

    @Synchronized
    fun start() {
        if (listener != null || nsd == null) return
        val discovery = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.w(MainActivity.TAG, "NSD discovery failed to start: $errorCode")
                synchronized(this@ServerDiscovery) { if (listener === this) listener = null }
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit

            override fun onServiceFound(service: NsdServiceInfo) {
                if (service.serviceType.contains(SERVICE_TYPE)) enqueue(service)
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                found.remove(service.serviceName)
            }
        }
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
            listener = discovery
        } catch (error: Exception) {
            Log.w(MainActivity.TAG, "NSD unavailable: $error")
        }
    }

    @Synchronized
    fun stop() {
        val current = listener ?: return
        listener = null
        queue.clear()
        try {
            nsd?.stopServiceDiscovery(current)
        } catch (_: Exception) {
            // already stopped
        }
    }

    @Synchronized
    private fun enqueue(service: NsdServiceInfo) {
        queue.addLast(service)
        if (!resolving) next()
    }

    @Synchronized
    private fun next() {
        val service = queue.removeFirstOrNull()
        if (service == null || nsd == null) {
            resolving = false
            return
        }
        resolving = true
        try {
            @Suppress("DEPRECATION")
            nsd.resolveService(service, object : NsdManager.ResolveListener {
                override fun onServiceResolved(info: NsdServiceInfo) {
                    address(info)?.let { found[info.serviceName] = "http://$it:${info.port}" }
                    next()
                }

                override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                    Log.w(MainActivity.TAG, "NSD could not resolve ${info.serviceName}: $errorCode")
                    next()
                }
            })
        } catch (error: Exception) {
            Log.w(MainActivity.TAG, "NSD resolve failed: $error")
            resolving = false
        }
    }

    /** IPv4 first: the shell and the server's CORS rules expect the plain `http://a.b.c.d:port` form. */
    private fun address(info: NsdServiceInfo): String? {
        val addresses: List<InetAddress> = if (Build.VERSION.SDK_INT >= 34) {
            info.hostAddresses
        } else {
            @Suppress("DEPRECATION")
            listOfNotNull(info.host)
        }
        val chosen = addresses.firstOrNull { it is Inet4Address } ?: addresses.firstOrNull { it is Inet6Address && !it.isLinkLocalAddress } ?: return null
        val host = chosen.hostAddress ?: return null
        return if (chosen is Inet6Address) "[$host]" else host
    }

    private companion object {
        const val SERVICE_TYPE = "_kinora._tcp"
    }
}
