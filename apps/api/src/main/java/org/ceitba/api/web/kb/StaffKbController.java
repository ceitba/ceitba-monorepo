package org.ceitba.api.web.kb;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.kb.KbImportService;
import org.ceitba.api.service.kb.KbModerationService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.drive.dto.PageResponse;
import org.ceitba.api.web.kb.dto.KbImportRequest;
import org.ceitba.api.web.kb.dto.KbImportResponse;
import org.ceitba.api.web.kb.dto.KbPageResponse;
import org.ceitba.api.web.kb.dto.KbStaffPageResponse;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

// STAFF side of the subject wikis: import, hide/restore, moderation list.
@Tag(name = "Subject wikis - staff")
@RestController
@RequestMapping("/v1/staff/kb")
@PreAuthorize("hasRole('STAFF')")
@SecurityRequirement(name = "bearerAuth")
public class StaffKbController {

    private final KbImportService importer;
    private final KbModerationService moderation;

    public StaffKbController(KbImportService importer, KbModerationService moderation) {
        this.importer = importer;
        this.moderation = moderation;
    }

    @PostMapping("/subjects/{subjectId}/import")
    @Operation(summary = "Import a subject's wiki pages (one transaction; rejected pages keep their last revision)")
    @ApiResponse(responseCode = "200", description = "OK")
    public KbImportResponse importSubject(@PathVariable String subjectId, @Valid @RequestBody KbImportRequest req) {
        return importer.importSubject(subjectId, req);
    }

    @PostMapping("/pages/{pageId}/hide")
    @Operation(summary = "Hide a page from readers")
    @ApiResponse(responseCode = "200", description = "OK")
    public KbPageResponse hide(@CurrentUser User user, @PathVariable UUID pageId) {
        return moderation.hide(user.getId(), pageId);
    }

    @PostMapping("/pages/{pageId}/restore")
    @Operation(summary = "Publish a page again and dismiss its reports")
    @ApiResponse(responseCode = "200", description = "OK")
    public KbPageResponse restore(@CurrentUser User user, @PathVariable UUID pageId) {
        return moderation.restore(user.getId(), pageId);
    }

    @GetMapping("/pages")
    @Operation(summary = "Pages by status (default HIDDEN), most recently changed first")
    @ApiResponse(responseCode = "200", description = "OK")
    public PageResponse<KbStaffPageResponse> pages(@RequestParam(required = false) String status,
                                                   @RequestParam(defaultValue = "0") int page,
                                                   @RequestParam(defaultValue = "20") int limit) {
        return moderation.list(status, page, limit);
    }
}
