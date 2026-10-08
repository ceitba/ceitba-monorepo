package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.InvalidStateException;
import org.ceitba.api.common.exception.ResourceAlreadyExistsException;
import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.domain.User;
import org.ceitba.api.domain.news.Article;
import org.ceitba.api.repository.news.ArticleRepository;
import org.ceitba.api.repository.news.OrganizationRepository;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.UUID;

@Service
public class ArticleService {

    // Statuses a non-staff author may give an independent (org-less)
    // article; publishing it is left to STAFF (moderation).
    public static final String PENDING_REVIEW = "pending_review";
    private static final Set<String> AUTHOR_STATUSES = Set.of("draft", PENDING_REVIEW);

    // Client-chosen ids (staff and org members only; independent authors
    // always get a generated UUID) must be URL-safe slugs.
    private static final Pattern ID_PATTERN = Pattern.compile("^[a-z0-9][a-z0-9-]{0,99}$");

    private final ArticleRepository articleRepo;
    private final OrganizationRepository orgRepo;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public ArticleService(ArticleRepository articleRepo, OrganizationRepository orgRepo,
                          ApplicationEventPublisher events, Clock clock) {
        this.articleRepo = articleRepo;
        this.orgRepo     = orgRepo;
        this.events      = events;
        this.clock       = clock;
    }

    // status=null lists every status; the controller decides who may pass
    // anything other than "published" (staff, members of `organization`, and
    // authors listing their own articles). createdBy=null = any author.
    @Transactional(readOnly = true)
    public Page<Article> findAll(String category, String organization, String status,
                                 UUID createdBy, Pageable pageable) {
        return articleRepo.findFiltered(category, organization, status, createdBy, pageable);
    }

    // ?mine=true: the caller's own independent (org-less) articles.
    @Transactional(readOnly = true)
    public Page<Article> findOwnIndependent(String category, String status, UUID createdBy,
                                            Pageable pageable) {
        return articleRepo.findIndependentByCreatedBy(category, status, createdBy, pageable);
    }

    // For a non-staff author's independent article: only draft or
    // pending_review; a missing status on create means pending_review.
    public static String requireAuthorStatus(String status, boolean defaultWhenMissing) {
        if (status == null) return defaultWhenMissing ? PENDING_REVIEW : null;
        if (!AUTHOR_STATUSES.contains(status)) {
            throw new ValidationException("status", status,
                "independent articles can only be 'draft' or 'pending_review' until staff publish them");
        }
        return status;
    }

    @Transactional(readOnly = true)
    public Article findById(String id, boolean includesDrafts) {
        var article = articleRepo.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Article", id));
        if (!includesDrafts && !"published".equals(article.getStatus())) {
            throw new ResourceNotFoundException("Article", id);
        }
        return article;
    }

    @Transactional
    public Article create(Article article, String organizationSlug, User createdBy) {
        if (article.getId() == null || article.getId().isBlank()) {
            article = rebuildWithId(article, UUID.randomUUID().toString());
        } else if (!ID_PATTERN.matcher(article.getId()).matches()) {
            throw new ValidationException("id", article.getId(),
                "must be 1-100 lowercase letters, digits or '-', starting with a letter or digit");
        } else if (articleRepo.existsById(article.getId())) {
            // Ids are assigned, so save() would merge over the existing row
            // (possibly another org's) instead of inserting.
            throw new ResourceAlreadyExistsException("Article", article.getId());
        }
        resolveOrganization(article, organizationSlug);
        article.setCreatedBy(createdBy);
        notifyFollowersOnce(article);
        return articleRepo.save(article);
    }

    // `featured` is separate from `patch` because Article.featured is a
    // primitive: null means the request omitted it and it stays unchanged.
    // `independentAuthor` is the caller's id when they act only as the author
    // of an independent article (not STAFF, not an org member), else null.
    // `clearPublishedAt` empties the date (a null in `patch` means unchanged).
    // `expectedStatus`, when set, must match the article's current status
    // (checked under the row lock), else 409 InvalidState.
    @Transactional
    public Article update(String id, Article patch, Boolean featured, String organizationSlug,
                          UUID independentAuthor, boolean clearPublishedAt, String expectedStatus) {
        var article = lockedForWrite(id, independentAuthor);
        if (expectedStatus != null && !expectedStatus.equals(article.getStatus())) {
            throw new InvalidStateException(
                "Article " + id + " is " + article.getStatus() + ", not " + expectedStatus);
        }
        if (patch.getTitle()      != null) article.setTitle(patch.getTitle());
        if (patch.getExcerpt()    != null) article.setExcerpt(patch.getExcerpt());
        if (patch.getBody()       != null) article.setBody(patch.getBody());
        if (patch.getCategory()   != null) article.setCategory(patch.getCategory());
        if (patch.getAuthors()    != null) article.setAuthors(patch.getAuthors());
        if (patch.getPublishedAt()!= null) article.setPublishedAt(patch.getPublishedAt());
        else if (clearPublishedAt)         article.setPublishedAt(null);
        if (patch.getReadingTime()!= null) article.setReadingTime(patch.getReadingTime());
        if (patch.getColorScheme()!= null) article.setColorScheme(patch.getColorScheme());
        if (patch.getCoverImage() != null) article.setCoverImage(patch.getCoverImage());
        if (patch.getStatus()     != null) article.setStatus(patch.getStatus());
        if (featured              != null) article.setFeatured(featured);
        if (organizationSlug != null) resolveOrganization(article, organizationSlug);
        notifyFollowersOnce(article);
        return articleRepo.save(article);
    }

    // `independentAuthor`: as in update().
    @Transactional
    public void delete(String id, UUID independentAuthor) {
        articleRepo.delete(lockedForWrite(id, independentAuthor));
    }

    // Loads the article under a row lock so writes to it (an author's edit
    // vs a staff publish) serialize. The controller's @PreAuthorize check ran
    // before the lock, so an independent author is re-checked here: if the
    // article was published (or claimed by an org) in between, the write is
    // refused with 409 InvalidState rather than silently undoing moderation.
    private Article lockedForWrite(String id, UUID independentAuthor) {
        var article = articleRepo.findByIdForUpdate(id)
            .orElseThrow(() -> new ResourceNotFoundException("Article", id));
        if (independentAuthor != null) {
            boolean stillEditable = article.getOrganization() == null
                && article.getCreatedBy() != null
                && independentAuthor.equals(article.getCreatedBy().getId())
                && !isPublished(article);
            if (!stillEditable) {
                throw new InvalidStateException(
                    "Article " + id + " is no longer an unpublished independent article of yours");
            }
        }
        return article;
    }

    // Followers of the article's organization get one push per article, the
    // first time it is published (created as published, or a draft flipped
    // to published). push_sent_at records it, so edits and an unpublish ->
    // republish never re-notify. Sent after commit by PushTriggerListener.
    private void notifyFollowersOnce(Article article) {
        if (!isPublished(article) || article.getPushSentAt() != null) return;
        article.markPushSent(OffsetDateTime.now(clock));
        NewsPushes.articlePublished(article).ifPresent(events::publishEvent);
    }

    private static boolean isPublished(Article article) {
        return "published".equals(article.getStatus());
    }

    private void resolveOrganization(Article article, String slug) {
        if (slug != null && !slug.isBlank()) {
            var org = orgRepo.findById(slug)
                .orElseThrow(() -> new ResourceNotFoundException("Organization", slug));
            article.setOrganization(org);
        }
    }

    // Article is immutable after construction for the id field; rebuild if needed.
    private Article rebuildWithId(Article src, String newId) {
        var a = new Article(newId, src.getTitle(), src.getExcerpt(), src.getBody(),
                            src.getCategory(), src.getAuthors());
        a.setPublishedAt(src.getPublishedAt());
        a.setReadingTime(src.getReadingTime());
        a.setFeatured(src.isFeatured());
        a.setColorScheme(src.getColorScheme());
        a.setCoverImage(src.getCoverImage());
        a.setStatus(src.getStatus());
        return a;
    }
}
