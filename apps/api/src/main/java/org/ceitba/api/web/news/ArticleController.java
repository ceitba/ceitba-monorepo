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
            // The caller's own independent (org-less) articles, any status
            // unless one is named (missing or `all` = every status).
            // `organization` is ignored: org articles are listed per org.
            // Anonymous -> empty page.
            UUID me = orgAccess.currentUserId(auth);
            Page<Article> own = me == null
                ? Page.empty(paging)
                : service.findOwnIndependent(category, mineStatusFilter(status), me, paging);
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
        boolean independentAuthor = !hasRole(auth, "ROLE_STAFF") && orgAccess.isIndependent(req.organization());
        // Independent authors never choose the id (a UUID is generated);
        // staff and org members may, subject to ArticleService's id format.
        var article = toEntity(req, independentAuthor ? null : req.id());
        if (independentAuthor) {
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
        // Non-staff callers that aren't members of the article's org got in
        // as the independent article's author; ArticleService re-checks that
        // under a row lock. authorOnly additionally excludes moves into an org
        // the author belongs to (member rules apply to status/featured).
        boolean staff = hasRole(auth, "ROLE_STAFF");
        boolean viaAuthorship = !staff && !orgAccess.canWriteForArticle(id, req.organization(), auth);
        UUID independentAuthor = viaAuthorship ? orgAccess.currentUserId(auth) : null;
        boolean authorOnly = viaAuthorship && !orgAccess.canWriteForOrg(req.organization(), auth);
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
        // Always copied, even when null: Article.status defaults to
        // "published", so leaving it would publish on any PATCH that omits it.
        patch.setStatus(req.status());
        boolean clearPublishedAt = req.publishedAt() == null && Boolean.TRUE.equals(req.clearPublishedAt());
        return ArticleResponse.from(service.update(id, patch, featured, req.organization(), independentAuthor,
            clearPublishedAt, req.expectedStatus()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('STAFF') or @orgAccess.canDeleteArticle(#id, authentication)"
        + " or @orgAccess.canDeleteOwnIndependentArticle(#id, authentication)")
    public ResponseEntity<Void> delete(@PathVariable String id, Authentication auth) {
        if (hasRole(auth, "ROLE_STAFF")) {
            service.delete(id, null);
        } else if (orgAccess.canDeleteArticle(id, auth)) {
            service.deleteAsOrgMember(id, orgAccess.currentUserId(auth));
        } else {
            service.delete(id, orgAccess.currentUserId(auth));
        }
        return ResponseEntity.noContent().build();
    }

    private Article toEntity(ArticleInput req, String id) {
        var a = new Article(id, req.title(), req.excerpt(), req.body(),
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
