package org.ceitba.api.web.news;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.ceitba.api.config.RateLimitProperties;
import org.ceitba.api.service.news.VoteService;
import org.ceitba.api.web.news.dto.VoteRequest;
import org.ceitba.api.web.news.dto.VoteResponse;
import org.ceitba.api.web.ratelimit.ClientIp;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/articles/{articleId}/votes")
public class VoteController {

    private final VoteService service;
    private final RateLimitProperties rateLimit;

    public VoteController(VoteService service, RateLimitProperties rateLimit) {
        this.service   = service;
        this.rateLimit = rateLimit;
    }

    @GetMapping
    public VoteResponse counts(@PathVariable String articleId) {
        var v = service.getCounts(articleId);
        return new VoteResponse(v.getUpCount(), v.getDownCount());
    }

    @PostMapping
    public VoteResponse cast(@PathVariable String articleId,
                              @RequestBody @Valid VoteRequest req,
                              HttpServletRequest http) {
        var v = service.cast(articleId, clientIp(http), http.getHeader("User-Agent"), req.type());
        return new VoteResponse(v.getUpCount(), v.getDownCount());
    }

    @DeleteMapping
    public ResponseEntity<Void> retract(@PathVariable String articleId,
                                         HttpServletRequest http) {
        service.retract(articleId, clientIp(http), http.getHeader("User-Agent"));
        return ResponseEntity.noContent().build();
    }

    // Same resolution as the rate limiter: the left-most X-Forwarded-For
    // entry is client-controlled, so trusting it let one client vote (or be
    // counted) as any number of "IPs".
    private String clientIp(HttpServletRequest req) {
        return ClientIp.resolve(req, rateLimit.trustForwardedFor());
    }
}
