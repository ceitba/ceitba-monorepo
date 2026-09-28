package org.ceitba.api.web.highlight;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.ceitba.api.service.highlight.HighlightService;
import org.ceitba.api.web.highlight.dto.HighlightRequest;
import org.ceitba.api.web.highlight.dto.HighlightResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
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

@Tag(name = "Highlights")
@RestController
@RequestMapping("/v1/highlights")
public class HighlightController {

    private final HighlightService service;

    public HighlightController(HighlightService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Home carousel highlights visible now",
        description = "Active highlights inside their optional startsAt/endsAt window, ordered by position.")
    public List<HighlightResponse> listVisible() {
        return service.listVisible();
    }

    @GetMapping("/all")
    @PreAuthorize("hasRole('STAFF')")
    @Operation(summary = "All highlights, including inactive, scheduled and expired (STAFF)")
    public List<HighlightResponse> listAll() {
        return service.listAll();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('STAFF')")
    public HighlightResponse create(@Valid @RequestBody HighlightRequest req) {
        return service.create(req);
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('STAFF')")
    public HighlightResponse update(@PathVariable UUID id, @Valid @RequestBody HighlightRequest req) {
        return service.update(id, req);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('STAFF')")
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }
}
