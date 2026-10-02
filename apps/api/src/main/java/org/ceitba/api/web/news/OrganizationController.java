package org.ceitba.api.web.news;

import jakarta.validation.Valid;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.service.news.OrganizationService;
import org.ceitba.api.web.news.dto.FollowerResponse;
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
    private final UserFollowRepository followRepo;
    private final FollowService followService;

    public OrganizationController(OrganizationService service,
                                   UserFollowRepository followRepo,
                                   FollowService followService) {
        this.service = service;
        this.followRepo = followRepo;
        this.followService = followService;
    }

    @GetMapping
    public Map<String, List<OrganizationResponse>> list() {
        return Map.of("data", service.findAll().stream()
            .map(this::toResponse).toList());
    }

    @GetMapping("/{slug}")
    public OrganizationResponse get(@PathVariable String slug) {
        return toResponse(service.findBySlug(slug));
    }

    @PostMapping
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<OrganizationResponse> create(@RequestBody @Valid OrganizationRequest req) {
        var org = new Organization(req.slug(), req.name(), req.fullName());
        org.setDescription(req.description());
        org.setCategory(req.category());
        org.setColor(req.color());
        org.setLogoUrl(req.logoUrl());
        org.setBackgroundUrl(req.backgroundUrl());
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(toResponse(service.create(org)));
    }

    @PatchMapping("/{slug}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canEditOrg(#slug, authentication)")
    public OrganizationResponse update(@PathVariable String slug,
                                        @RequestBody OrganizationRequest req) {
        // null = leave unchanged (OrganizationService.update skips nulls)
        var patch = new Organization(slug, req.name(), req.fullName());
        patch.setDescription(req.description());
        patch.setCategory(req.category());
        patch.setColor(req.color());
        patch.setLogoUrl(req.logoUrl());
        patch.setBackgroundUrl(req.backgroundUrl());
        return toResponse(service.update(slug, patch));
    }

    @DeleteMapping("/{slug}")
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<Void> delete(@PathVariable String slug) {
        service.delete(slug);
        return ResponseEntity.noContent().build();
    }

    // Followers panel: org admins see who follows their own org, staff sees
    // anyone's. Mirrors the `canEditOrg` rule used by PATCH so the same set
    // of people who can edit the profile can read the audience.
    @GetMapping("/{slug}/followers")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canEditOrg(#slug, authentication)")
    public Map<String, Object> listFollowers(@PathVariable String slug) {
        List<FollowerResponse> followers = followService.listFollowers(slug);
        return Map.of(
            "data",  followers,
            "count", (long) followers.size()
        );
    }

    private OrganizationResponse toResponse(Organization org) {
        return OrganizationResponse.from(org, followRepo.countByOrganization(org.getSlug()));
    }
}
