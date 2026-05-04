package org.ceitba.api.web.news;

import jakarta.validation.Valid;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.service.news.ArticleService;
import org.ceitba.api.web.auth.CurrentUser;
import org.ceitba.api.web.news.dto.ArticleInput;
import org.ceitba.api.web.news.dto.ArticlePatchInput;
import org.ceitba.api.web.news.dto.ArticleResponse;
import org.ceitba.api.web.news.dto.PageResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/v1/articles")
public class ArticleController {

    private final ArticleService service;

    public ArticleController(ArticleService service) {
        this.service = service;
    }

    @GetMapping
    public PageResponse<ArticleResponse> list(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String organization,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit,
            Authentication auth) {

        // Non-staff callers may only see published articles; staff with no param also default to published
        boolean isStaff = hasRole(auth, "ROLE_STAFF");
        String effectiveStatus = (isStaff && status != null) ? status : "published";

        var result = service.findAll(category, organization, effectiveStatus,
                                     PageRequest.of(Math.max(page - 1, 0), limit));
        return new PageResponse<>(
            result.getContent().stream().map(ArticleResponse::from).toList(),
            new PageResponse.Meta(result.getTotalElements(), page, limit)
        );
    }

    @GetMapping("/{id}")
    public ArticleResponse get(@PathVariable String id, Authentication auth) {
        return ArticleResponse.from(service.findById(id, hasRole(auth, "ROLE_STAFF")));
    }

    @PostMapping
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForOrg(#req.organization(), authentication)")
    public ResponseEntity<ArticleResponse> create(@RequestBody @Valid ArticleInput req,
                                                   @CurrentUser User user) {
        var article = toEntity(req);
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(ArticleResponse.from(service.create(article, req.organization(), user)));
    }

    @PatchMapping("/{id}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForArticle(#id, #req.organization(), authentication)")
    public ArticleResponse patch(@PathVariable String id,
                                  @RequestBody ArticlePatchInput req) {
        var patch = new Article(
            id,
            req.title(),
            req.excerpt(),
            req.body(), req.category(), null);
        if (req.authors()     != null) patch.setAuthors(req.authors());
        if (req.publishedAt() != null) patch.setPublishedAt(req.publishedAt());
        if (req.readingTime() != null) patch.setReadingTime(req.readingTime());
        if (req.colorScheme() != null) patch.setColorScheme(req.colorScheme());
        if (req.coverImage()  != null) patch.setCoverImage(req.coverImage());
        if (req.status()      != null) patch.setStatus(req.status());
        if (req.featured()    != null) patch.setFeatured(req.featured());
        return ArticleResponse.from(service.update(id, patch, req.organization()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('STAFF')")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    private Article toEntity(ArticleInput req) {
        var a = new Article(req.id(), req.title(), req.excerpt(), req.body(),
                            req.category(), req.authors());
        if (req.publishedAt() != null) a.setPublishedAt(req.publishedAt());
        if (req.readingTime() != null) a.setReadingTime(req.readingTime());
        a.setFeatured(req.featured());
        if (req.colorScheme() != null) a.setColorScheme(req.colorScheme());
        if (req.coverImage()  != null) a.setCoverImage(req.coverImage());
        a.setStatus(req.status() != null ? req.status() : "published");
        return a;
    }

    private boolean hasRole(Authentication auth, String role) {
        if (auth == null) return false;
        return auth.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .anyMatch(role::equals);
    }
}
