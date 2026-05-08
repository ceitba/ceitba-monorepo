package org.ceitba.api.web.share;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.share.ShareSessionService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.share.dto.CreateShareSessionRequest;
import org.ceitba.api.web.share.dto.JoinShareSessionRequest;
import org.ceitba.api.web.share.dto.ShareSessionResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

// Group sharing for the scheduler SPA. The GET-by-token endpoint is public
// (anyone with the link sees the heatmap) but every write requires the JWT
// session cookie; SecurityConfig has the matching matchers.
@Tag(name = "Share")
@RestController
@RequestMapping("/v1/share/sessions")
public class ShareSessionController {

    private final ShareSessionService service;

    public ShareSessionController(ShareSessionService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a share session anchored to one of my saved schedules")
    public ShareSessionResponse create(@CurrentUser User user,
                                        @Valid @RequestBody CreateShareSessionRequest req) {
        return service.create(user, req);
    }

    @GetMapping("/{token}")
    @Operation(summary = "Public read of a share session by its token")
    public ShareSessionResponse get(@PathVariable String token) {
        return service.readByToken(token);
    }

    @PostMapping("/{token}/join")
    @Operation(summary = "Attach my saved schedule to this session (or replace my prior pick)")
    public ShareSessionResponse join(@CurrentUser User user,
                                      @PathVariable String token,
                                      @Valid @RequestBody JoinShareSessionRequest req) {
        return service.join(user, token, req);
    }

    @DeleteMapping("/{token}/leave")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Remove my participation from this session")
    public void leave(@CurrentUser User user, @PathVariable String token) {
        service.leave(user, token);
    }

    @DeleteMapping("/{token}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete a session (creator only). 404 to non-creators.")
    public void delete(@CurrentUser User user, @PathVariable String token) {
        service.delete(user, token);
    }
}
