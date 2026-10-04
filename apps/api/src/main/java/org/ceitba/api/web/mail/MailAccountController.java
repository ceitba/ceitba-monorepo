package org.ceitba.api.web.mail;

import org.ceitba.api.domain.User;
import org.ceitba.api.service.mail.MailSenderAccountService;
import org.ceitba.api.web.auth.CurrentUser;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

// Connected Gmail sender accounts (docs/WEEKLY-DIGEST.md, "Sending through the
// Gmail API"). STAFF-only, except the OAuth callback Google redirects the
// browser to: it is authenticated by the signed `state` minted by connect.
// Responses never carry tokens.
@RestController
@RequestMapping("/v1/mail/accounts")
public class MailAccountController {

    public record ConnectResponse(String authorizationUrl) {}

    private final MailSenderAccountService service;

    public MailAccountController(MailSenderAccountService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasRole('STAFF')")
    public List<MailSenderAccountService.AccountView> list() {
        return service.list();
    }

    @PostMapping("/ceitba/connect")
    @PreAuthorize("hasRole('STAFF')")
    public ConnectResponse connect(@CurrentUser User user) {
        return new ConnectResponse(service.connect(user.getId()).toString());
    }

    // Redirects to <DIGEST_PUBLIC_BASE_URL>/admin/digests?mail=connected, or
    // ?mail=error&reason=<code>.
    @GetMapping("/oauth/callback")
    public ResponseEntity<Void> callback(@RequestParam(required = false) String code,
                                         @RequestParam(required = false) String state,
                                         @RequestParam(required = false) String error) {
        return ResponseEntity.status(HttpStatus.FOUND)
            .header(HttpHeaders.LOCATION, service.handleCallback(code, state, error).toString())
            .header(HttpHeaders.CACHE_CONTROL, "no-store")
            .build();
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }
}
