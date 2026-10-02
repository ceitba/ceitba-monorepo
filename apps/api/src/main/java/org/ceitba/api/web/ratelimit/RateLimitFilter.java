package org.ceitba.api.web.ratelimit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.TimeMeter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.ceitba.api.config.RateLimitProperties;
import org.ceitba.api.web.error.ErrorResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

// In-memory, per-client-IP rate limiting (bucket4j). Registered inside the
// Spring Security chain right after CORS (see SecurityConfig), so 429s carry
// CORS headers and run before any authentication work. Not a @Component on
// purpose: Spring Boot would otherwise also register it as a servlet filter.
//
// State is per-instance: with N API replicas the effective limit is N x the
// configured one. Fine for the current single-VPS deployment.
//
// Client IP: see ClientIp (right-most X-Forwarded-For entry, only from our
// proxy).
//
// IPv6 clients are keyed by their /64 prefix: a single subscriber usually
// gets a whole /64 and can rotate through its addresses at will, so keying
// by full address would let one client multiply its limit. IPv4 (including
// IPv4-mapped IPv6) is keyed by the full address.
public class RateLimitFilter extends OncePerRequestFilter {

    static final String XFF = ClientIp.XFF;

    private final RateLimitProperties props;
    private final List<Map.Entry<String, RateLimitProperties.Rule>> rules;
    private final TimeMeter timeMeter;
    private final Cache<String, Bucket> buckets;
    private final AntPathMatcher matcher = new AntPathMatcher();
    private final ObjectMapper json = new ObjectMapper()
        .registerModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    public RateLimitFilter(RateLimitProperties props) {
        this(props, TimeMeter.SYSTEM_MILLISECONDS);
    }

    RateLimitFilter(RateLimitProperties props, TimeMeter timeMeter) {
        this.props = props;
        this.rules = List.copyOf(props.rules().entrySet());
        this.timeMeter = timeMeter;
        // Idle buckets are dropped after the longest period: a fresh bucket is
        // full anyway, so evicting a bucket that has fully refilled is lossless.
        Duration idle = props.rules().values().stream()
            .map(RateLimitProperties.Rule::period)
            .max(Duration::compareTo)
            .orElse(Duration.ofMinutes(1));
        this.buckets = Caffeine.newBuilder()
            .maximumSize(props.maxTrackedClients())
            .expireAfterAccess(idle)
            .build();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !props.enabled() || rules.isEmpty() || "OPTIONS".equalsIgnoreCase(request.getMethod());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        var rule = match(request.getMethod(), pathWithinApplication(request));
        if (rule == null) {
            chain.doFilter(request, response);
            return;
        }

        String key = rule.getKey() + "|" + clientKey(clientIp(request));
        var bucket = buckets.get(key, k -> newBucket(rule.getValue()));
        var probe = bucket.tryConsumeAndReturnRemaining(1);
        if (probe.isConsumed()) {
            response.setHeader("X-RateLimit-Limit", Long.toString(rule.getValue().capacity()));
            response.setHeader("X-RateLimit-Remaining", Long.toString(probe.getRemainingTokens()));
            chain.doFilter(request, response);
            return;
        }

        long retryAfterSeconds = Math.max(1, (probe.getNanosToWaitForRefill() + 999_999_999L) / 1_000_000_000L);
        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader("Retry-After", Long.toString(retryAfterSeconds));
        response.setHeader("X-RateLimit-Limit", Long.toString(rule.getValue().capacity()));
        response.setHeader("X-RateLimit-Remaining", "0");
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(response.getOutputStream(), ErrorResponse.of(
            "TooManyRequests", "Rate limit exceeded. Retry in " + retryAfterSeconds + "s.",
            request.getRequestURI()));
    }

    private Map.Entry<String, RateLimitProperties.Rule> match(String method, String path) {
        for (var e : rules) {
            var rule = e.getValue();
            if (rule.appliesTo(method) && matchesAny(rule.paths(), path)
                    && !matchesAny(rule.excludePaths(), path)) return e;
        }
        return null;
    }

    private boolean matchesAny(List<String> patterns, String path) {
        for (var pattern : patterns) {
            if (matcher.match(pattern, path)) return true;
        }
        return false;
    }

    private Bucket newBucket(RateLimitProperties.Rule rule) {
        return Bucket.builder()
            .addLimit(l -> l.capacity(rule.capacity()).refillGreedy(rule.capacity(), rule.period()))
            .withCustomTimePrecision(timeMeter)
            .build();
    }

    private static String pathWithinApplication(HttpServletRequest request) {
        String uri = request.getRequestURI();
        String ctx = request.getContextPath();
        return (ctx != null && !ctx.isEmpty() && uri.startsWith(ctx)) ? uri.substring(ctx.length()) : uri;
    }

    String clientIp(HttpServletRequest request) {
        return ClientIp.resolve(request, props.trustForwardedFor());
    }

    // Rate-limit key for a client address: the /64 prefix for IPv6, the
    // address itself otherwise (or when it does not parse as an IP literal).
    static String clientKey(String addr) {
        if (addr == null || !addr.contains(":")) return addr;
        String literal = addr;
        if (literal.startsWith("[") && literal.endsWith("]")) literal = literal.substring(1, literal.length() - 1);
        int zone = literal.indexOf('%');
        if (zone >= 0) literal = literal.substring(0, zone);
        try {
            // Contains ':' so InetAddress parses it as an IPv6 literal and
            // never performs a DNS lookup.
            var ip = InetAddress.getByName(literal);
            if (!(ip instanceof Inet6Address)) return ip.getHostAddress(); // IPv4-mapped
            byte[] prefix = Arrays.copyOf(ip.getAddress(), 16);
            Arrays.fill(prefix, 8, 16, (byte) 0);
            return InetAddress.getByAddress(prefix).getHostAddress() + "/64";
        } catch (UnknownHostException e) {
            return addr;
        }
    }

    static boolean isPrivatePeer(String addr) {
        return ClientIp.isPrivatePeer(addr);
    }
}
