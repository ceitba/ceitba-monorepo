package org.ceitba.api.web.correction;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.correction.ScheduleCorrectionService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.correction.dto.CorrectionResponse;
import org.ceitba.api.web.correction.dto.MyCorrectionResponse;
import org.ceitba.api.web.correction.dto.SuggestCorrectionRequest;
import org.ceitba.api.web.correction.dto.SuggestCorrectionResponse;
import org.ceitba.api.web.correction.dto.VoteCorrectionRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// Student-suggested schedule corrections. Every route here needs an
// allowlisted user session (SecurityConfig anyRequest); the public read is
// the overlay in GET /v1/subjects. Responses never identify the suggester or
// the voters. See docs/SCHEDULE-CORRECTIONS.md.
@Tag(name = "Schedule corrections")
@RestController
@SecurityRequirement(name = "bearerAuth")
public class ScheduleCorrectionController {

    private final ScheduleCorrectionService service;

    public ScheduleCorrectionController(ScheduleCorrectionService service) {
        this.service = service;
    }

    @PostMapping("/v1/commissions/{commissionId}/schedule-corrections")
    @Operation(summary = "Suggest a corrected schedule for a commission",
        description = "201 with created=true, or 200 with created=false and the existing correction when "
            + "an identical open one exists. The suggestion counts as the caller's CONFIRM vote.")
    public ResponseEntity<SuggestCorrectionResponse> suggest(@CurrentUser User user,
                                                             @PathVariable String commissionId,
                                                             @Valid @RequestBody SuggestCorrectionRequest req) {
        var result = service.suggest(commissionId, user.getId(), req.schedule());
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK).body(result);
    }

    @PutMapping("/v1/schedule-corrections/{id}/vote")
    @Operation(summary = "Confirm or reject a schedule correction (replaces the caller's vote)")
    public CorrectionResponse vote(@CurrentUser User user, @PathVariable UUID id,
                                   @Valid @RequestBody VoteCorrectionRequest req) {
        return service.vote(id, user.getId(), req.type());
    }

    @DeleteMapping("/v1/schedule-corrections/{id}/vote")
    @Operation(summary = "Remove the caller's vote on a schedule correction")
    public CorrectionResponse removeVote(@CurrentUser User user, @PathVariable UUID id) {
        return service.removeVote(id, user.getId());
    }

    @GetMapping("/v1/me/schedule-corrections")
    @Operation(summary = "The caller's own schedule corrections, newest first")
    public List<MyCorrectionResponse> mine(@CurrentUser User user) {
        return service.mine(user.getId());
    }

    @PostMapping("/v1/me/schedule-corrections/{id}/seen")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Dismiss the 'your correction was applied' notice")
    public void seen(@CurrentUser User user, @PathVariable UUID id) {
        service.markSeen(id, user.getId());
    }
}
