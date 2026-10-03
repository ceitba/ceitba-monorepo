package org.ceitba.api.web.drive;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.drive.DriveModerationService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.drive.dto.PageResponse;
import org.ceitba.api.web.drive.dto.ReprocessResponse;
import org.ceitba.api.web.drive.dto.StaffCommentRequest;
import org.ceitba.api.web.drive.dto.StaffFileResponse;
import org.ceitba.api.web.drive.dto.StaffSourceResponse;
import org.ceitba.api.web.drive.dto.UnclaimedShareResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// STAFF moderation of Apuntes (docs/DRIVE-SYNC.md). Staff always see the
// owner of a folder, also when it publishes anonymously.
@Tag(name = "Apuntes (Drive sync) - staff")
@RestController
@RequestMapping("/v1/staff/drive")
@PreAuthorize("hasRole('STAFF')")
@SecurityRequirement(name = "bearerAuth")
public class StaffDriveController {

    private final DriveModerationService service;

    public StaffDriveController(DriveModerationService service) {
        this.service = service;
    }

    @GetMapping("/sources")
    @Operation(summary = "Connected folders, newest first (optionally by status)")
    @ApiResponse(responseCode = "200", description = "OK")
    public PageResponse<StaffSourceResponse> sources(@RequestParam(required = false) String status,
                                                     @RequestParam(defaultValue = "0") int page,
                                                     @RequestParam(defaultValue = "20") int limit) {
        return service.sources(status, page, limit);
    }

    @PostMapping("/sources/{id}/approve")
    @Operation(summary = "Approve a folder: its own files with a subject get published")
    @ApiResponse(responseCode = "200", description = "OK")
    public StaffSourceResponse approve(@CurrentUser User user, @PathVariable UUID id,
                                       @Valid @RequestBody(required = false) StaffCommentRequest req) {
        return service.approve(user.getId(), id, req == null ? null : req.comment());
    }

    @PostMapping("/sources/{id}/block")
    @Operation(summary = "Block a folder: nothing of it is published")
    @ApiResponse(responseCode = "200", description = "OK")
    public StaffSourceResponse block(@CurrentUser User user, @PathVariable UUID id,
                                     @Valid @RequestBody(required = false) StaffCommentRequest req) {
        return service.block(user.getId(), id, req == null ? null : req.comment());
    }

    @GetMapping("/files")
    @Operation(summary = "Files by publication (default NEEDS_REVIEW), most recently changed first")
    @ApiResponse(responseCode = "200", description = "OK")
    public PageResponse<StaffFileResponse> files(@RequestParam(required = false) String publication,
                                                 @RequestParam(defaultValue = "0") int page,
                                                 @RequestParam(defaultValue = "20") int limit) {
        return service.files(publication, page, limit);
    }

    @PostMapping("/files/{id}/publish")
    @Operation(summary = "Publish a file (sticks across syncs; reports no longer hide it)")
    @ApiResponse(responseCode = "200", description = "OK")
    public StaffFileResponse publish(@PathVariable UUID id) {
        return service.publish(id);
    }

    @PostMapping("/files/{id}/remove")
    @Operation(summary = "Remove a file from Apuntes (sticks across syncs)")
    @ApiResponse(responseCode = "200", description = "OK")
    public StaffFileResponse remove(@PathVariable UUID id) {
        return service.remove(id);
    }

    @PostMapping("/files/{id}/restore")
    @Operation(summary = "Undo a staff decision and dismiss the file's reports")
    @ApiResponse(responseCode = "200", description = "OK")
    public StaffFileResponse restore(@PathVariable UUID id) {
        return service.restore(id);
    }

    @PostMapping("/reprocess")
    @Operation(summary = "Re-export Google files of a kind (default DOC) on a sync queued now",
        description = "Kinds: DOC, SLIDES, SHEET, DRAWING. Unchanged results keep their stored copy.")
    @ApiResponse(responseCode = "200", description = "OK")
    public ReprocessResponse reprocess(@RequestParam(required = false) String kind) {
        return service.reprocess(kind);
    }

    @GetMapping("/unclaimed")
    @Operation(summary = "Folders shared with the bot that nobody connected")
    @ApiResponse(responseCode = "200", description = "OK")
    public List<UnclaimedShareResponse> unclaimed() {
        return service.unclaimed();
    }
}
