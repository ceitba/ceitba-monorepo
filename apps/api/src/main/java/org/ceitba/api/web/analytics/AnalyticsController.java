package org.ceitba.api.web.analytics;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.ceitba.api.config.RateLimitProperties;
import org.ceitba.api.service.news.AnalyticsService;
import org.ceitba.api.service.news.AnalyticsService.EventPayload;
import org.ceitba.api.service.news.VoteService;
import org.ceitba.api.web.analytics.dto.AnalyticsEventBatch;
import org.ceitba.api.web.ratelimit.ClientIp;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;

@RestController
@RequestMapping("/v1/analytics")
public class AnalyticsController {

    private final AnalyticsService service;
    private final RateLimitProperties rateLimit;

    public AnalyticsController(AnalyticsService service, RateLimitProperties rateLimit) {
        this.service   = service;
        this.rateLimit = rateLimit;
    }

    @PostMapping("/events")
    public ResponseEntity<Void> ingest(@RequestBody @Valid AnalyticsEventBatch batch,
                                        HttpServletRequest http) {
        String ipHash = hashIp(clientIp(http));
        List<EventPayload> payloads = batch.events().stream()
            .map(e -> new EventPayload(e.type(), e.sessionId(), e.timestamp(),
                                       e.articleId(), e.category(), e.path()))
            .toList();
        service.ingestBatch(payloads, ipHash);
        return ResponseEntity.status(HttpStatus.ACCEPTED).build();
    }

    @GetMapping("/summary")
    @PreAuthorize("hasRole('STAFF')")
    public AnalyticsService.Summary summary(@RequestParam(defaultValue = "30") int days) {
        return service.summary(days);
    }

    // Same resolution as the rate limiter: the left-most X-Forwarded-For
    // entry is client-controlled, so trusting it let one client vote (or be
    // counted) as any number of "IPs".
    private String clientIp(HttpServletRequest req) {
        return ClientIp.resolve(req, rateLimit.trustForwardedFor());
    }

    private String hashIp(String ip) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            var digest = md.digest(ip.getBytes(StandardCharsets.UTF_8));
            var sb = new StringBuilder(64);
            for (byte b : digest) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }
}
