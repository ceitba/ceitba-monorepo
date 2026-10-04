package org.ceitba.api.web.mail;

import jakarta.servlet.http.HttpServletRequest;
import org.ceitba.api.config.RateLimitProperties;
import org.ceitba.api.service.digest.DigestTrackingService;
import org.ceitba.api.web.ratelimit.ClientIp;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.Base64;

// Public open pixel and click redirects of tracked emails (the weekly digest,
// docs/WEEKLY-DIGEST.md). Both always answer and never error: a 1x1 GIF, or
// a 302 to the link's stored URL (the newsletter home for anything unknown).
// Recording is best effort, rate limited per client and per tracking id
// inside DigestTrackingService. Session cookies are ignored
// (CookieOrHeaderBearerTokenResolver), so a stale one never turns a click
// into a 401.
@RestController
@RequestMapping("/v1/mail")
public class MailTrackingController {

    private static final Logger log = LoggerFactory.getLogger(MailTrackingController.class);

    // 1x1 transparent GIF (42 bytes).
    static final byte[] PIXEL = Base64.getDecoder().decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");

    private final DigestTrackingService tracking;
    private final boolean trustForwardedFor;

    public MailTrackingController(DigestTrackingService tracking, RateLimitProperties rateLimit) {
        this.tracking = tracking;
        this.trustForwardedFor = rateLimit.trustForwardedFor();
    }

    // /v1/mail/o/{trackingId}.gif
    @GetMapping("/o/{file}")
    public ResponseEntity<byte[]> open(@PathVariable String file, HttpServletRequest request) {
        try {
            String id = file.endsWith(".gif") ? file.substring(0, file.length() - 4) : file;
            tracking.open(id, client(request));
        } catch (RuntimeException e) {
            log.debug("Open not recorded: {}", e.toString());
        }
        return ResponseEntity.ok()
            .contentType(MediaType.IMAGE_GIF)
            .cacheControl(CacheControl.noStore().mustRevalidate().cachePrivate())
            .header(HttpHeaders.PRAGMA, "no-cache")
            .header(HttpHeaders.EXPIRES, "0")
            .body(PIXEL);
    }

    @GetMapping("/c/{trackingId}/{linkId}")
    public ResponseEntity<Void> click(@PathVariable String trackingId, @PathVariable String linkId,
                                      HttpServletRequest request) {
        URI target;
        try {
            target = URI.create(tracking.click(trackingId, linkId, client(request)));
        } catch (RuntimeException e) {
            log.debug("Click not recorded: {}", e.toString());
            target = URI.create(tracking.fallbackUrl());
        }
        return ResponseEntity.status(HttpStatus.FOUND)
            .location(target)
            .cacheControl(CacheControl.noStore())
            .header("Referrer-Policy", "no-referrer")
            .build();
    }

    private DigestTrackingService.ClientInfo client(HttpServletRequest request) {
        return new DigestTrackingService.ClientInfo(request.getHeader(HttpHeaders.USER_AGENT), request.getMethod(),
            ClientIp.resolve(request, trustForwardedFor));
    }
}
