package org.ceitba.api.web.drive;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.drive.DriveSourceService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.drive.dto.AcceptSuggestionsResponse;
import org.ceitba.api.web.drive.dto.DriveInfoResponse;
import org.ceitba.api.web.drive.dto.RegisterSourceRequest;
import org.ceitba.api.web.drive.dto.SourceResponse;
import org.ceitba.api.web.drive.dto.SourceTreeResponse;
import org.ceitba.api.web.drive.dto.TreeItemResponse;
import org.ceitba.api.web.drive.dto.UpdateFileRequest;
import org.ceitba.api.web.drive.dto.UpdateSourceRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

// A student's Drive folders for Apuntes (docs/DRIVE-SYNC.md). Any allowlisted
// user (SecurityConfig anyRequest). 503 DRIVE_SYNC_UNCONFIGURED when the
// server has no Drive key.
@Tag(name = "Apuntes (Drive sync)")
@RestController
@RequestMapping("/v1/me/drive")
@SecurityRequirement(name = "bearerAuth")
public class MyDriveController {

    private final DriveSourceService service;

    public MyDriveController(DriveSourceService service) {
        this.service = service;
    }

    @GetMapping("/info")
    @Operation(summary = "Bot email to share folders with, and the current consent text/version")
    @ApiResponse(responseCode = "200", description = "OK")
    public DriveInfoResponse info() {
        return service.info();
    }

    @PostMapping("/sources")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Connect a Drive folder shared with the bot",
        description = "Errors: DRIVE_INVALID_FOLDER_URL 400, DRIVE_FOLDER_NOT_SHARED 422, "
            + "DRIVE_FOLDER_NOT_OWNED 403, DRIVE_SOURCE_EXISTS 409. Queues an immediate sync.")
    @ApiResponse(responseCode = "201", description = "Connected")
    public SourceResponse register(@CurrentUser User user, @Valid @RequestBody RegisterSourceRequest req) {
        return service.register(user, req);
    }

    @GetMapping("/sources")
    @Operation(summary = "The caller's connected folders")
    @ApiResponse(responseCode = "200", description = "OK")
    public List<SourceResponse> list(@CurrentUser User user) {
        return service.list(user);
    }

    @GetMapping("/sources/{id}/tree")
    @Operation(summary = "Flat tree of a connected folder with subjects, suggestions and publication")
    @ApiResponse(responseCode = "200", description = "OK")
    public SourceTreeResponse tree(@CurrentUser User user, @PathVariable UUID id) {
        return service.tree(user, id);
    }

    @PatchMapping("/sources/{id}")
    @Operation(summary = "Publish anonymously or with the caller's name")
    @ApiResponse(responseCode = "200", description = "OK")
    public SourceResponse update(@CurrentUser User user, @PathVariable UUID id,
                                 @Valid @RequestBody UpdateSourceRequest req) {
        return service.update(user, id, req.anonymous());
    }

    @DeleteMapping("/sources/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Disconnect a folder: unpublishes and deletes every copied file")
    @ApiResponse(responseCode = "204", description = "Disconnected")
    public void disconnect(@CurrentUser User user, @PathVariable UUID id) {
        service.disconnect(user, id);
    }

    @PostMapping("/sources/{id}/sync")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Sync now (at most once per 5 minutes per folder)",
        description = "429 DRIVE_SYNC_RATE_LIMITED with Retry-After when called too soon.")
    @ApiResponse(responseCode = "202", description = "Queued")
    public void sync(@CurrentUser User user, @PathVariable UUID id) {
        service.requestSync(user, id);
    }

    @PostMapping("/sources/{id}/accept-suggestions")
    @Operation(summary = "Apply every suggested subject (top-down; inherited subjects win)")
    @ApiResponse(responseCode = "200", description = "OK")
    public AcceptSuggestionsResponse acceptSuggestions(@CurrentUser User user, @PathVariable UUID id) {
        return service.acceptSuggestions(user, id);
    }

    @PostMapping("/sources/{id}/recompute-suggestions")
    @Operation(summary = "Recompute subject suggestions with the caller's current plan; returns the tree")
    @ApiResponse(responseCode = "200", description = "OK")
    public SourceTreeResponse recomputeSuggestions(@CurrentUser User user, @PathVariable UUID id) {
        return service.recomputeSuggestions(user, id);
    }

    @PatchMapping("/files/{fileId}")
    @Operation(summary = "Set a file/folder's subject (\"\" clears it) or hide it")
    @ApiResponse(responseCode = "200", description = "OK")
    public TreeItemResponse updateFile(@CurrentUser User user, @PathVariable UUID fileId,
                                       @Valid @RequestBody UpdateFileRequest req) {
        return service.updateFile(user, fileId, req);
    }
}
