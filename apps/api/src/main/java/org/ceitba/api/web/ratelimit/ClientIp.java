package org.ceitba.api.web.ratelimit;

import jakarta.servlet.http.HttpServletRequest;

import java.net.InetAddress;
import java.net.UnknownHostException;

// The caller's IP address as seen by our reverse proxy. Shared by the rate
// limiter and the endpoints that key anonymous state by IP (vote dedup,
// analytics), so a client cannot pick its own identity via X-Forwarded-For.
//
// When trustForwardedFor is on we take the RIGHT-most X-Forwarded-For entry,
// i.e. the address our own reverse proxy (Caddy) observed. Left-most entries
// are client-controlled and trivially spoofed. XFF is only honoured when the
// direct peer (remoteAddr) is a loopback, site-local, link-local or IPv6
// unique-local address, i.e. our proxy on the Docker network. A request that
// reaches the API from a public address skipped the proxy and controls the
// whole header, so its remoteAddr is used.
public final class ClientIp {

    static final String XFF = "X-Forwarded-For";

    private ClientIp() {}

    public static String resolve(HttpServletRequest request, boolean trustForwardedFor) {
        if (trustForwardedFor && isPrivatePeer(request.getRemoteAddr())) {
            String xff = request.getHeader(XFF);
            if (xff != null && !xff.isBlank()) {
                String[] parts = xff.split(",");
                String last = parts[parts.length - 1].trim();
                if (!last.isEmpty()) return last;
            }
        }
        return request.getRemoteAddr();
    }

    static boolean isPrivatePeer(String addr) {
        // remoteAddr is always an IP literal; refuse anything else so
        // InetAddress never performs a DNS lookup.
        if (addr == null || !(addr.contains(":") || addr.matches("\\d{1,3}(\\.\\d{1,3}){3}"))) return false;
        try {
            var ip = InetAddress.getByName(addr);
            if (ip.isLoopbackAddress() || ip.isSiteLocalAddress() || ip.isLinkLocalAddress()) return true;
            byte[] b = ip.getAddress();
            return b.length == 16 && (b[0] & 0xFE) == 0xFC; // fc00::/7
        } catch (UnknownHostException e) {
            return false;
        }
    }
}
