package org.ceitba.api.web.wiki;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.ceitba.api.domain.User;
import org.ceitba.api.service.wiki.SubjectBookmarkService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.wiki.dto.BookmarkStateResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "Wiki")
@RestController
@RequestMapping("/v1/wiki/bookmarks")
public class SubjectBookmarkController {

    private final SubjectBookmarkService service;

    public SubjectBookmarkController(SubjectBookmarkService service) {
        this.service = service;
    }

    // Public — returns the global count + (false if anonymous) bookmark flag.
    @GetMapping("/{subjectId}")
    @Operation(summary = "Estado de bookmark del usuario y conteo global")
    public BookmarkStateResponse getState(@PathVariable String subjectId,
                                           @CurrentUser User user) {
        return service.getState(subjectId, user != null ? user.getId() : null);
    }

    @PostMapping("/{subjectId}")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Crear bookmark (usuario actual)")
    public BookmarkStateResponse create(@PathVariable String subjectId,
                                         @CurrentUser User user) {
        return service.upsert(subjectId, user.getId());
    }

    @PutMapping("/{subjectId}")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Setear bookmark ON (idempotente)")
    public BookmarkStateResponse set(@PathVariable String subjectId,
                                      @CurrentUser User user) {
        return service.upsert(subjectId, user.getId());
    }

    @DeleteMapping("/{subjectId}")
    @SecurityRequirement(name = "bearerAuth")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Eliminar bookmark (idempotente)")
    public void remove(@PathVariable String subjectId, @CurrentUser User user) {
        service.remove(subjectId, user.getId());
    }
}
