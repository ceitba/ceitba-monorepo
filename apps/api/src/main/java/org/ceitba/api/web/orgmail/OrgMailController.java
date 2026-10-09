package org.ceitba.api.web.orgmail;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.mail.MailSenderAccountService;
import org.ceitba.api.service.orgmail.OrgAnnouncementService;
import org.ceitba.api.service.orgmail.OrgAnnouncementService.AnnouncementView;
import org.ceitba.api.service.orgmail.OrgAnnouncementService.MailStatus;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

// Organizations' emails to their followers (docs/ORGANIZATIONS.md). The
// account and the announcements are for the org's admins (and STAFF); the
// one-click unsubscribe is public (signed token); a follower switches an
// org's emails on or off for themself.
@Tag(name = "Organizations")
@RestController
public class OrgMailController {

    private static final String ADMIN = "hasRole('STAFF') or @orgAccess.canManageMembers(#slug, authentication)";

    private final OrgAnnouncementService service;
    private final MailSenderAccountService accounts;

    public OrgMailController(OrgAnnouncementService service, MailSenderAccountService accounts) {
        this.service = service;
        this.accounts = accounts;
    }

    public record ConnectResponse(String authorizationUrl) {}

    public record AnnouncementRequest(String subject, String body) {}

    public record MailPreference(@NotNull Boolean enabled) {}

    @GetMapping("/v1/organizations/{slug}/mail")
    @PreAuthorize(ADMIN)
    @Operation(summary = "The org's connected Gmail account, its quota and the weekly cap")
    public MailStatus status(@PathVariable String slug) {
        return service.status(slug);
    }

    // Only the org's own admins connect (the callback re-checks it).
    @PostMapping("/v1/organizations/{slug}/mail/connect")
    @PreAuthorize("@orgAccess.canManageMembers(#slug, authentication)")
    @Operation(summary = "Start connecting the org's Gmail account (Google consent URL)")
    public ConnectResponse connect(@PathVariable String slug, @CurrentUser User user) {
        return new ConnectResponse(accounts.connectOrg(slug, user.getId()).toString());
    }

    @DeleteMapping("/v1/organizations/{slug}/mail")
    @PreAuthorize(ADMIN)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Disconnect the org's Gmail account")
    public void disconnect(@PathVariable String slug) {
        accounts.disconnectOrg(slug);
    }

    @GetMapping("/v1/organizations/{slug}/announcements")
    @PreAuthorize(ADMIN)
    public List<AnnouncementView> list(@PathVariable String slug) {
        return service.list(slug);
    }

    @PostMapping("/v1/organizations/{slug}/announcements")
    @PreAuthorize(ADMIN)
    @ResponseStatus(HttpStatus.CREATED)
    public AnnouncementView create(@PathVariable String slug, @CurrentUser User user,
                                   @RequestBody AnnouncementRequest req) {
        return service.create(slug, req.subject(), req.body(), user.getId());
    }

    @PatchMapping("/v1/organizations/{slug}/announcements/{id}")
    @PreAuthorize(ADMIN)
    public AnnouncementView update(@PathVariable String slug, @PathVariable Long id,
                                   @RequestBody AnnouncementRequest req) {
        return service.update(slug, id, req.subject(), req.body());
    }

    @DeleteMapping("/v1/organizations/{slug}/announcements/{id}")
    @PreAuthorize(ADMIN)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String slug, @PathVariable Long id) {
        service.delete(slug, id);
    }

    @PostMapping("/v1/organizations/{slug}/announcements/{id}/test")
    @PreAuthorize(ADMIN)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Send the draft to the caller only")
    public void sendTest(@PathVariable String slug, @PathVariable Long id, @CurrentUser User user) {
        service.sendTest(slug, id, user);
    }

    @PostMapping("/v1/organizations/{slug}/announcements/{id}/send")
    @PreAuthorize(ADMIN)
    @Operation(summary = "Send the draft to the org's followers")
    public AnnouncementView send(@PathVariable String slug, @PathVariable Long id) {
        return service.send(slug, id);
    }

    // RFC 8058 one-click target and the newsletter's unsubscribe page.
    @PostMapping("/v1/org-mail/unsubscribe")
    public Map<String, String> unsubscribe(@RequestParam(required = false) String token) {
        return Map.of("organization", service.unsubscribe(token));
    }

    @GetMapping("/v1/me/follows/{slug}/mail")
    public MailPreference preference(@PathVariable String slug, @CurrentUser User user) {
        return new MailPreference(service.receivesMail(user.getId(), slug));
    }

    @PutMapping("/v1/me/follows/{slug}/mail")
    public MailPreference setPreference(@PathVariable String slug, @CurrentUser User user,
                                        @Valid @RequestBody MailPreference req) {
        service.setReceivesMail(user.getId(), slug, req.enabled());
        return new MailPreference(req.enabled());
    }
}
