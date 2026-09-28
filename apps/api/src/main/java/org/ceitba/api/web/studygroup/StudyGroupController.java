package org.ceitba.api.web.studygroup;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.StudyGroupType;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.studygroup.StudyGroupService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.news.dto.PageResponse;
import org.ceitba.api.web.studygroup.dto.CreateStudyGroupRequest;
import org.ceitba.api.web.studygroup.dto.StudyGroupResponse;
import org.ceitba.api.web.studygroup.dto.UpdateStudyGroupRequest;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Student study groups. Every route needs a signed-in USER (JWT or user API
// key); the allowlist gate from SecurityConfig applies as for any other
// authenticated route. Edit/delete are further limited to the owner or a
// MODERATOR in StudyGroupService, which decides from the caller's id and
// whether they hold ROLE_MODERATOR.
@Tag(name = "Study groups")
@RestController
@PreAuthorize("hasRole('USER')")
public class StudyGroupController {

    private final StudyGroupService service;

    public StudyGroupController(StudyGroupService service) {
        this.service = service;
    }

    @GetMapping("/v1/study-groups")
    @Operation(summary = "List study groups, soonest due first. Upcoming only unless upcoming=false. "
        + "Paginated as {data, meta}; items omit participants.")
    public PageResponse<StudyGroupResponse> list(@CurrentUser User user,
                                                 @RequestParam(required = false) String subject,
                                                 @RequestParam(required = false) StudyGroupType type,
                                                 @RequestParam(defaultValue = "true") boolean upcoming,
                                                 @RequestParam(defaultValue = "1") int page,
                                                 @RequestParam(defaultValue = "20") int limit,
                                                 Authentication auth) {
        var result = service.list(user.getId(), isModerator(auth), subject, type, upcoming, page, limit);
        return new PageResponse<>(result.getContent(),
            new PageResponse.Meta(result.getTotalElements(), result.getNumber() + 1, result.getSize()));
    }

    @GetMapping("/v1/me/study-groups")
    @Operation(summary = "Study groups the caller owns or joined, soonest due first. Upcoming only unless upcoming=false.")
    public List<StudyGroupResponse> mine(@CurrentUser User user,
                                         @RequestParam(defaultValue = "true") boolean upcoming,
                                         Authentication auth) {
        return service.listMine(user.getId(), isModerator(auth), upcoming);
    }

    @GetMapping("/v1/study-groups/{id}")
    @Operation(summary = "One study group with its participants (name and avatar only). contactLink is members-only.")
    public StudyGroupResponse get(@CurrentUser User user, @PathVariable UUID id, Authentication auth) {
        return service.get(user.getId(), isModerator(auth), id);
    }

    @PostMapping("/v1/study-groups")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Create a study group; the caller becomes its owner and first participant")
    public StudyGroupResponse create(@CurrentUser User user, @Valid @RequestBody CreateStudyGroupRequest req) {
        return service.create(user.getId(), req);
    }

    @PatchMapping("/v1/study-groups/{id}")
    @Operation(summary = "Edit a study group (owner or moderator). 409 when capacity would drop below the member count.")
    public StudyGroupResponse update(@CurrentUser User user, @PathVariable UUID id,
                                     @Valid @RequestBody UpdateStudyGroupRequest req, Authentication auth) {
        return service.update(user.getId(), isModerator(auth), id, req);
    }

    @DeleteMapping("/v1/study-groups/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Delete a study group (owner or moderator)")
    public void delete(@CurrentUser User user, @PathVariable UUID id, Authentication auth) {
        service.delete(user.getId(), isModerator(auth), id);
    }

    @PostMapping("/v1/study-groups/{id}/join")
    @Operation(summary = "Join a study group. Idempotent for members; 409 StudyGroupFull / StudyGroupPastDue otherwise.")
    public StudyGroupResponse join(@CurrentUser User user, @PathVariable UUID id, Authentication auth) {
        return service.join(user.getId(), isModerator(auth), id);
    }

    @DeleteMapping("/v1/study-groups/{id}/membership")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Leave a study group (404 if not a member). If the owner leaves, ownership passes to the "
        + "earliest remaining joiner, or the group is deleted when nobody else is in it.")
    public void leave(@CurrentUser User user, @PathVariable UUID id) {
        service.leave(user.getId(), id);
    }

    private static boolean isModerator(Authentication auth) {
        return auth != null && auth.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .anyMatch("ROLE_MODERATOR"::equals);
    }
}
