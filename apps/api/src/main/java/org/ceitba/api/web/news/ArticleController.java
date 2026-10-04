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
import org.springframework.data.domain.Page;
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
import java.util.UUID;

@RestController
@RequestMapping("/v1/articles")
public class ArticleController {

    // Status filter value that lists every status (draft and published).
    static final String ALL_STATUSES = "all";

    private final ArticleService service;
    private final OrgAccess orgAccess;

    public ArticleController(ArticleService service, OrgAccess orgAccess) {
        this.service = service;
        this.orgAccess = orgAccess;
    }

    @GetMapping
    public PageResponse<ArticleResponse> list(
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String organization,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "false") boolean mine,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int limit,
            Authentication auth) {

        var paging = NewsPaging.of(page, limit);
        if (mine) {
            // The caller's own articles, any status unless one is named
            // (missing or `all` = every status). Anonymous -> empty page.
            UUID me = orgAccess.currentUserId(auth);
            Page<Article> own = me == null
                ? Page.empty(paging)
                : service.findAll(category, organization, mineStatusFilter(status), me, paging);
            return toPage(own);
        }

        // Staff, and members of the requested organization, may pick a status
        // (`all` = no filter); a missing status still means published. Anyone
        // else only ever sees published articles, whatever they pass.
        boolean seesDrafts = hasRole(auth, "ROLE_STAFF")
            || (organization != null && orgAccess.canReadDraftsOf(organization, auth));
        String effectiveStatus = seesDrafts ? statusFilter(status) : "published";

        return toPage(service.findAll(category, organization, effectiveStatus, null, paging));
    }

    private static PageResponse<ArticleResponse> toPage(Page<Article> result) {
        return new PageResponse<>(
            result.getContent().stream().map(ArticleResponse::from).toList(),
            PageResponse.Meta.of(result)
        );
    }

    @GetMapping("/{id}")
    public ArticleResponse get(@PathVariable String id, Authentication auth) {
        boolean includesDrafts = hasRole(auth, "ROLE_STAFF")
            || orgAccess.canReadArticleDraft(id, auth);
        return ArticleResponse.from(service.findById(id, includesDrafts));
    }

    // Besides STAFF and members of `organization`, any signed-in user may
    // create an independent (org-less) article; a non-staff author may only
    // leave it as draft or submit it for review (default pending_review).
    @PostMapping
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForOrg(#req.organization(), authentication)"
        + " or (hasRole('USER') and @orgAccess.isIndependent(#req.organization()))")
    public ResponseEntity<ArticleResponse> create(@RequestBody @Valid ArticleInput req,
                                                   @CurrentUser User user,
                                                   Authentication auth) {
        var article = toEntity(req);
        if (!hasRole(auth, "ROLE_STAFF") && orgAccess.isIndependent(req.organization())) {
            article.setStatus(ArticleService.requireAuthorStatus(req.status(), true));
            article.setFeatured(false);
        }
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(ArticleResponse.from(service.create(article, req.organization(), user)));
    }

    // The author of an independent article may also edit it until STAFF
    // publish it, keeping it draft/pending_review — unless the patch moves
    // it into an org they belong to, where the member rules apply.
    @PatchMapping("/{id}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canWriteForArticle(#id, #req.organization(), authentication)"
        + " or @orgAccess.canEditOwnIndependentArticle(#id, #req.organization(), authentication)")
    public ArticleResponse patch(@PathVariable String id,
                                  @RequestBody @Valid ArticlePatchInput req,
                                  Authentication auth) {
        boolean authorOnly = !hasRole(auth, "ROLE_STAFF")
            && !orgAccess.canWriteForArticle(id, req.organization(), auth)
            && !orgAccess.canWriteForOrg(req.organization(), auth);
        if (authorOnly) ArticleService.requireAuthorStatus(req.status(), false);
        Boolean featured = authorOnly ? null : req.featured();
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
        return ArticleResponse.from(service.update(id, patch, featured, req.organization()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canDeleteOwnIndependentArticle(#id, authentication)")
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

    // null = no status filter.
    private static String statusFilter(String status) {
        if (status == null || status.isBlank()) return "published";
        return ALL_STATUSES.equals(status) ? null : status;
    }

    // ?mine=true: missing or `all` = every status.
    private static String mineStatusFilter(String status) {
        if (status == null || status.isBlank() || ALL_STATUSES.equals(status)) return null;
        return status;
    }

    private boolean hasRole(Authentication auth, String role) {
        if (auth == null) return false;
        return auth.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .anyMatch(role::equals);
    }
}
