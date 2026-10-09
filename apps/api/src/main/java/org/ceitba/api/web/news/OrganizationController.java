package org.ceitba.api.web.news;

import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.repository.news.UserFollowRepository;
import org.ceitba.api.service.news.FollowService;
import org.ceitba.api.service.media.MediaUploadService;
import org.ceitba.api.service.news.OrganizationMembershipService;
import org.ceitba.api.service.news.OrganizationService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.media.dto.SignUploadRequest;
import org.ceitba.api.web.media.dto.SignUploadResponse;
import org.ceitba.api.web.news.dto.FollowerResponse;
import org.ceitba.api.web.news.dto.OrganizationPatchRequest;
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
    private final OrganizationMembershipService memberships;
    private final MediaUploadService uploads;

    public OrganizationController(OrganizationService service,
                                   UserFollowRepository followRepo,
                                   FollowService followService,
                                   OrganizationMembershipService memberships,
                                   MediaUploadService uploads) {
        this.service = service;
        this.followRepo = followRepo;
        this.followService = followService;
        this.memberships = memberships;
        this.uploads = uploads;
    }

    @GetMapping
    public Map<String, List<OrganizationResponse>> list() {
        return Map.of("data", service.findAll().stream()
            .map(this::toResponse).toList());
    }

    @GetMapping("/{slug}")
    public OrganizationResponse get(@PathVariable String slug) {
        var org = service.findBySlug(slug);
        return OrganizationResponse.from(org, followRepo.countByOrganization(slug), memberships.board(slug));
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
        var profile = new OrganizationService.ProfileFields(req.instagram(), req.linkedinUrl(), req.websiteUrl(),
            req.contactEmail(), req.recruitingOpen(), req.recruitingUrl(), req.recruitingText());
        service.applyProfile(org, profile);
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(toResponse(service.create(org)));
    }

    @PatchMapping("/{slug}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canEditOrg(#slug, authentication)")
    public OrganizationResponse update(@PathVariable String slug,
                                        @RequestBody @Valid OrganizationPatchRequest req) {
        // null = leave unchanged (OrganizationService.update skips nulls)
        var patch = new Organization(slug, req.name(), req.fullName());
        patch.setDescription(req.description());
        patch.setCategory(req.category());
        patch.setColor(req.color());
        patch.setLogoUrl(req.logoUrl());
        patch.setBackgroundUrl(req.backgroundUrl());
        var profile = new OrganizationService.ProfileFields(req.instagram(), req.linkedinUrl(), req.websiteUrl(),
            req.contactEmail(), req.recruitingOpen(), req.recruitingUrl(), req.recruitingText());
        return toResponse(service.update(slug, patch, profile));
    }

    @DeleteMapping("/{slug}")
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<Void> delete(@PathVariable String slug) {
        service.delete(slug);
        return ResponseEntity.noContent().build();
    }

    // Followers panel: org admins (membership role 'admin') see who follows
    // their own org, staff sees anyone's. Stricter than PATCH's `canEditOrg`
    // on purpose: the list exposes names and emails, plain members don't need it.
    @GetMapping("/{slug}/followers")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canViewFollowers(#slug, authentication)")
    public Map<String, Object> listFollowers(@PathVariable String slug) {
        List<FollowerResponse> followers = followService.listFollowers(slug);
        return Map.of(
            "data",  followers,
            "count", (long) followers.size()
        );
    }

    // Presigned upload of an org image (logo, background, article or event
    // cover) by any member: jpeg/png/webp up to 5 MB, under orgs/{slug}/,
    // rate-limited per user (rate-limit.user-rules.org-images).
    @PostMapping("/{slug}/media/sign-upload")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForOrg(#slug, authentication)")
    public SignUploadResponse signUpload(@PathVariable String slug, @CurrentUser User user,
                                         @RequestBody @Valid SignUploadRequest req) {
        service.findBySlug(slug);
        return uploads.signOrgImage(slug, user.getId(), req);
    }

    private OrganizationResponse toResponse(Organization org) {
        return OrganizationResponse.from(org, followRepo.countByOrganization(org.getSlug()));
    }
}
