package org.ceitba.api.web.digest;

import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.digest.DigestCorrectionVoteService;
import org.ceitba.api.service.digest.DigestService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.digest.dto.DigestDtos;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// "La semana en ITBA" weekly digest (docs/WEEKLY-DIGEST.md). Issue endpoints
// are STAFF-only; subscription is any signed-in user; unsubscribe is public
// (signed token, also the RFC 8058 one-click target) and so is the
// correction vote of "Tu cuatrimestre" (signed per-reader token). {id} only matches a
// UUID, so the literal subscription/unsubscribe paths never collide with it.
@RestController
@RequestMapping("/v1/digests")
public class DigestController {

    private static final String ID = "/{id:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}}";

    private final DigestService service;
    private final DigestCorrectionVoteService correctionVotes;

    public DigestController(DigestService service, DigestCorrectionVoteService correctionVotes) {
        this.service = service;
        this.correctionVotes = correctionVotes;
    }

    @GetMapping
    @PreAuthorize("hasRole('STAFF')")
    public List<DigestDtos.Summary> list() {
        return service.list();
    }

    // The sending account's rolling 24h quota and any active pause.
    @GetMapping("/quota")
    @PreAuthorize("hasRole('STAFF')")
    public DigestDtos.Quota quota() {
        return service.quota();
    }

    @PostMapping
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<DigestDtos.Detail> create(@RequestBody @Valid DigestDtos.CreateRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(req.weekStart()));
    }

    @GetMapping(ID)
    @PreAuthorize("hasRole('STAFF')")
    public DigestDtos.Detail get(@PathVariable UUID id) {
        return service.detail(id);
    }

    // Aggregate opens/clicks (never per person).
    @GetMapping(ID + "/stats")
    @PreAuthorize("hasRole('STAFF')")
    public DigestDtos.Stats stats(@PathVariable UUID id) {
        return service.stats(id);
    }

    @PatchMapping(ID)
    @PreAuthorize("hasRole('STAFF')")
    public DigestDtos.Detail patch(@PathVariable UUID id, @RequestBody @Valid DigestDtos.PatchRequest req) {
        return service.patch(id, req);
    }

    @GetMapping(value = ID + "/preview", produces = MediaType.TEXT_HTML_VALUE)
    @PreAuthorize("hasRole('STAFF')")
    // The shared content plus the caller's own "Tu cuatrimestre"; `mode`
    // (all|me) is accepted and ignored for compatibility.
    public ResponseEntity<String> preview(@PathVariable UUID id,
                                          @RequestParam(required = false) String mode,
                                          @CurrentUser User user) {
        return ResponseEntity.ok()
            .contentType(new MediaType(MediaType.TEXT_HTML, java.nio.charset.StandardCharsets.UTF_8))
            .body(service.previewHtml(id, user.getId()));
    }

    // Consumes sending quota: 429 MAIL_QUOTA_EXHAUSTED (with resumeAt) when none is left.
    @PostMapping(ID + "/test")
    @PreAuthorize("hasRole('STAFF')")
    public DigestDtos.TestSendResponse test(@PathVariable UUID id, @CurrentUser User user) {
        return new DigestDtos.TestSendResponse(service.sendTest(id, user.getId()));
    }

    @PostMapping(ID + "/send")
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<DigestDtos.Detail> send(@PathVariable UUID id, @CurrentUser User user) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(service.send(id, user.getId()));
    }

    // From draft, or while sending ("stop sending": pending deliveries dropped).
    @PostMapping(ID + "/cancel")
    @PreAuthorize("hasRole('STAFF')")
    public DigestDtos.Detail cancel(@PathVariable UUID id) {
        return service.cancel(id);
    }

    @GetMapping("/subscription")
    public DigestDtos.Subscription subscription(@CurrentUser User user) {
        return new DigestDtos.Subscription(service.isSubscribed(user.getId()));
    }

    @PutMapping("/subscription")
    public DigestDtos.Subscription setSubscription(@RequestBody @Valid DigestDtos.Subscription req,
                                                   @CurrentUser User user) {
        return new DigestDtos.Subscription(service.setSubscribed(user.getId(), req.enabled()));
    }

    // Public, token-authenticated ("¿Es así?" links of "Tu cuatrimestre").
    // Read-only: email scanners follow links, so only the POST votes.
    @GetMapping("/correction-vote")
    public DigestDtos.CorrectionVoteView correctionVote(@RequestParam(required = false) String token) {
        return correctionVotes.view(token);
    }

    @PostMapping("/correction-vote")
    public DigestDtos.CorrectionVoteResult voteCorrection(@RequestBody @Valid DigestDtos.CorrectionVoteRequest req) {
        return correctionVotes.vote(req.token(), req.vote());
    }

    // Public. Token in the query string; the body (if any) is the RFC 8058
    // form "List-Unsubscribe=One-Click" and is not needed.
    @PostMapping("/unsubscribe")
    public ResponseEntity<Void> unsubscribe(@RequestParam(required = false) String token) {
        service.unsubscribe(token);
        return ResponseEntity.noContent().build();
    }
}
