package org.ceitba.api.web.staff;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.push.PushBroadcastService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.staff.dto.PushBroadcastRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

// Push to every registered device. STAFF only: /v1/staff/** is
// path-protected in SecurityConfig and @PreAuthorize repeats it.
@Tag(name = "Staff")
@RestController
@RequestMapping("/v1/staff/push")
@SecurityRequirement(name = "bearerAuth")
@PreAuthorize("hasRole('STAFF')")
public class PushBroadcastController {

    private final PushBroadcastService broadcasts;

    public PushBroadcastController(PushBroadcastService broadcasts) {
        this.broadcasts = broadcasts;
    }

    @PostMapping("/broadcast")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Queue a push notification to every registered device (202; delivery is "
        + "asynchronous and a no-op when FCM is not configured). data: optional string map, "
        + "conventionally {type, id} for deep links")
    public void broadcast(@CurrentUser User staff, @Valid @RequestBody PushBroadcastRequest req) {
        broadcasts.broadcast(req.title(), req.body(), req.data(), staff != null ? staff.getId() : null);
    }
}
