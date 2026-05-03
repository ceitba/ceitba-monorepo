package org.ceitba.api.web.news;

import jakarta.validation.Valid;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.service.news.OrganizationService;
import org.ceitba.api.web.news.dto.OrganizationRequest;
import org.ceitba.api.web.news.dto.OrganizationResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/v1/organizations")
public class OrganizationController {

    private final OrganizationService service;

    public OrganizationController(OrganizationService service) {
        this.service = service;
    }

    @GetMapping
    public Map<String, List<OrganizationResponse>> list() {
        return Map.of("data", service.findAll().stream()
            .map(OrganizationResponse::from).toList());
    }

    @GetMapping("/{slug}")
    public OrganizationResponse get(@PathVariable String slug) {
        return OrganizationResponse.from(service.findBySlug(slug));
    }

    @PostMapping
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<OrganizationResponse> create(@RequestBody @Valid OrganizationRequest req) {
        var org = new Organization(req.slug(), req.name(), req.fullName());
        org.setDescription(req.description());
        org.setCategory(req.category());
        org.setColor(req.color());
        org.setMemberCount(req.memberCount());
        org.setFoundedYear(req.foundedYear());
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(OrganizationResponse.from(service.create(org)));
    }

    @PatchMapping("/{slug}")
    @PreAuthorize("hasRole('STAFF')")
    public OrganizationResponse update(@PathVariable String slug,
                                        @RequestBody OrganizationRequest req) {
        var patch = new Organization(slug,
            req.name() != null ? req.name() : "",
            req.fullName() != null ? req.fullName() : "");
        patch.setDescription(req.description());
        patch.setCategory(req.category());
        patch.setColor(req.color());
        patch.setMemberCount(req.memberCount());
        patch.setFoundedYear(req.foundedYear());
        return OrganizationResponse.from(service.update(slug, patch));
    }

    @DeleteMapping("/{slug}")
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<Void> delete(@PathVariable String slug) {
        service.delete(slug);
        return ResponseEntity.noContent().build();
    }
}
