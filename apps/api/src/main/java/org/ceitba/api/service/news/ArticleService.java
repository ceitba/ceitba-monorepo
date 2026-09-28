package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.ResourceNotFoundException;
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
import java.util.UUID;

@Service
public class ArticleService {

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

    // Public callers pass status="published"; staff may pass status=null (all) or "draft".
    public Page<Article> findAll(String category, String organization, String status, Pageable pageable) {
        return articleRepo.findFiltered(category, organization, status, pageable);
    }

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
        }
        resolveOrganization(article, organizationSlug);
        article.setCreatedBy(createdBy);
        notifyFollowersOnce(article);
        return articleRepo.save(article);
    }

    @Transactional
    public Article update(String id, Article patch, String organizationSlug) {
        var article = articleRepo.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("Article", id));
        if (patch.getTitle()      != null) article.setTitle(patch.getTitle());
        if (patch.getExcerpt()    != null) article.setExcerpt(patch.getExcerpt());
        if (patch.getBody()       != null) article.setBody(patch.getBody());
        if (patch.getCategory()   != null) article.setCategory(patch.getCategory());
        if (patch.getAuthors()    != null) article.setAuthors(patch.getAuthors());
        if (patch.getPublishedAt()!= null) article.setPublishedAt(patch.getPublishedAt());
        if (patch.getReadingTime()!= null) article.setReadingTime(patch.getReadingTime());
        if (patch.getColorScheme()!= null) article.setColorScheme(patch.getColorScheme());
        if (patch.getCoverImage() != null) article.setCoverImage(patch.getCoverImage());
        if (patch.getStatus()     != null) article.setStatus(patch.getStatus());
        article.setFeatured(patch.isFeatured());
        if (organizationSlug != null) resolveOrganization(article, organizationSlug);
        notifyFollowersOnce(article);
        return articleRepo.save(article);
    }

    @Transactional
    public void delete(String id) {
        if (!articleRepo.existsById(id)) {
            throw new ResourceNotFoundException("Article", id);
        }
        articleRepo.deleteById(id);
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
