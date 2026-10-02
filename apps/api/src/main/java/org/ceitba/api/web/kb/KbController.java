package org.ceitba.api.web.kb;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.kb.KbReaderService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.kb.dto.KbGraphResponse;
import org.ceitba.api.web.kb.dto.KbPageResponse;
import org.ceitba.api.web.kb.dto.KbReportRequest;
import org.ceitba.api.web.kb.dto.KbSubjectResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

// Subject wikis for logged-in readers (docs/SUBJECT-WIKI.md).
@Tag(name = "Subject wikis")
@RestController
@SecurityRequirement(name = "bearerAuth")
public class KbController {

    private final KbReaderService service;

    public KbController(KbReaderService service) {
        this.service = service;
    }

    @GetMapping("/v1/wiki/subjects/{subjectId}/kb")
    @Operation(summary = "A subject's wiki: index page, page list and related subjects")
    @ApiResponse(responseCode = "200", description = "OK")
    public KbSubjectResponse subject(@CurrentUser User user, @PathVariable String subjectId) {
        return service.subject(user, subjectId);
    }

    @GetMapping("/v1/wiki/subjects/{subjectId}/kb/graph")
    @Operation(summary = "Pages of the subject and the pages of other subjects they link to or from")
    @ApiResponse(responseCode = "200", description = "OK")
    public KbGraphResponse graph(@CurrentUser User user, @PathVariable String subjectId) {
        return service.graph(user, subjectId);
    }

    @GetMapping("/v1/wiki/subjects/{subjectId}/kb/{slug}")
    @Operation(summary = "One wiki page with its resolved links, backlinks and sources")
    @ApiResponse(responseCode = "200", description = "OK")
    public KbPageResponse page(@CurrentUser User user, @PathVariable String subjectId, @PathVariable String slug) {
        return service.page(user, subjectId, slug);
    }

    @PutMapping("/v1/wiki/kb/pages/{pageId}/report")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Report a page (one report per user; 3 reports hide it)")
    @ApiResponse(responseCode = "204", description = "Reported")
    public void report(@CurrentUser User user, @PathVariable UUID pageId, @Valid @RequestBody KbReportRequest req) {
        service.report(user, pageId, req);
    }
}
