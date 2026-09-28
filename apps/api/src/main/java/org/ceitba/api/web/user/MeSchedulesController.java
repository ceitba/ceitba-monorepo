package org.ceitba.api.web.user;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.user.SavedScheduleService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.user.dto.SaveScheduleRequest;
import org.ceitba.api.web.user.dto.SavedScheduleResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Per-user saved schedule snapshots from the scheduler SPA. Authenticated
// access is enforced by the existing anyRequest().access(...) gate; no
// additional path matchers needed.
@Tag(name = "Me")
@RestController
@RequestMapping("/v1/me/schedules")
public class MeSchedulesController {

    private final SavedScheduleService service;

    public MeSchedulesController(SavedScheduleService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "List the user's saved schedules (most recent first)")
    public List<SavedScheduleResponse> list(@CurrentUser User user) {
        return service.list(user.getId());
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get one saved schedule by id")
    public SavedScheduleResponse get(@CurrentUser User user, @PathVariable UUID id) {
        return service.get(user.getId(), id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Save a new schedule (the user's first one becomes primary). 409 if the per-user limit is reached.")
    public SavedScheduleResponse create(@CurrentUser User user,
                                         @Valid @RequestBody SaveScheduleRequest req) {
        return service.create(user.getId(), req);
    }

    @PutMapping("/{id}")
    @Operation(summary = "Replace name/payload of an existing saved schedule (isPrimary is unchanged)")
    public SavedScheduleResponse update(@CurrentUser User user,
                                         @PathVariable UUID id,
                                         @Valid @RequestBody SaveScheduleRequest req) {
        return service.update(user.getId(), id, req);
    }

    @PutMapping("/{id}/primary")
    @Operation(summary = "Make this the user's primary schedule (clears the previous primary). Idempotent.")
    public SavedScheduleResponse makePrimary(@CurrentUser User user, @PathVariable UUID id) {
        return service.makePrimary(user.getId(), id);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete a saved schedule. Deleting the primary leaves the user with no primary.")
    public void delete(@CurrentUser User user, @PathVariable UUID id) {
        service.delete(user.getId(), id);
    }
}
