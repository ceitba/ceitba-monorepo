package org.ceitba.api.web.drive;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.drive.DriveReaderService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.drive.dto.ApuntesSubjectResponse;
import org.ceitba.api.web.drive.dto.FileDetailResponse;
import org.ceitba.api.web.drive.dto.ReportFileRequest;
import org.ceitba.api.web.drive.dto.SubjectFilesResponse;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.util.List;
import java.util.UUID;

// Apuntes for logged-in readers. Readers only see PUBLISHED files; the
// owner student and STAFF can also open unpublished ones (preview).
@Tag(name = "Apuntes (Drive sync)")
@RestController
@SecurityRequirement(name = "bearerAuth")
public class ApuntesController {

    private final DriveReaderService service;

    public ApuntesController(DriveReaderService service) {
        this.service = service;
    }

    @GetMapping("/v1/wiki/apuntes/subjects")
    @Operation(summary = "Subjects with published apuntes (no q), subjects matching q by code/name, "
        + "or (mine=true) the caller's plan subjects by year/semester ([] without a plan; q/limit ignored)")
    @ApiResponse(responseCode = "200", description = "OK")
    public List<ApuntesSubjectResponse> subjects(@CurrentUser User user,
                                                 @RequestParam(required = false) String q,
                                                 @RequestParam(defaultValue = "20") int limit,
                                                 @RequestParam(defaultValue = "false") boolean mine) {
        if (mine) return service.mySubjects(user);
        return service.subjects(q, limit);
    }

    @GetMapping("/v1/wiki/subjects/{subjectId}/files")
    @Operation(summary = "Published apuntes of a subject, grouped by connected folder")
    @ApiResponse(responseCode = "200", description = "OK")
    public SubjectFilesResponse subjectFiles(@PathVariable String subjectId) {
        return service.subjectFiles(subjectId);
    }

    @GetMapping("/v1/wiki/files/{fileId}")
    @Operation(summary = "One file with its sanitized HTML (Docs only)")
    @ApiResponse(responseCode = "200", description = "OK")
    public FileDetailResponse file(@CurrentUser User user, @PathVariable UUID fileId) {
        return service.file(user, fileId);
    }

    @GetMapping("/v1/wiki/files/{fileId}/download")
    @Operation(summary = "302 to a 5-minute signed URL of the PDF or the original",
        description = "disposition=inline (default; PDF, images and text are shown by the browser) or "
            + "attachment. Other types are always attachments.")
    @ApiResponse(responseCode = "302", description = "Redirect to the signed URL")
    public ResponseEntity<Void> download(@CurrentUser User user, @PathVariable UUID fileId,
                                         @RequestParam(required = false) String variant,
                                         @RequestParam(required = false) String disposition) {
        return redirect(service.downloadUrl(user, fileId, variant, disposition));
    }

    @GetMapping("/v1/wiki/files/{fileId}/assets/{name}")
    @Operation(summary = "302 to a signed URL of an image embedded in a Doc's HTML")
    @ApiResponse(responseCode = "302", description = "Redirect to the signed URL")
    public ResponseEntity<Void> asset(@CurrentUser User user, @PathVariable UUID fileId, @PathVariable String name) {
        return redirect(service.assetUrl(user, fileId, name));
    }

    @PutMapping("/v1/wiki/files/{fileId}/report")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Report a file (one report per user; 3 reports hide it)")
    @ApiResponse(responseCode = "204", description = "Reported")
    public void report(@CurrentUser User user, @PathVariable UUID fileId, @Valid @RequestBody ReportFileRequest req) {
        service.report(user, fileId, req);
    }

    private static ResponseEntity<Void> redirect(String url) {
        return ResponseEntity.status(HttpStatus.FOUND)
            .location(URI.create(url))
            .cacheControl(CacheControl.noStore())
            .build();
    }
}
