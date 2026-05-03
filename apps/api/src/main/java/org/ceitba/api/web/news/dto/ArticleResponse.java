package org.ceitba.api.web.news.dto;

import org.ceitba.api.domain.news.Article;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

public record ArticleResponse(
    String         id,
    String         title,
    String         excerpt,
    List<String>   body,
    String         category,
    String         organization,
    String         author,
    LocalDate      publishedAt,
    String         readingTime,
    boolean        featured,
    String         colorScheme,
    String         coverImage,
    String         status,
    OffsetDateTime createdAt,
    OffsetDateTime updatedAt
) {
    public static ArticleResponse from(Article a) {
        return new ArticleResponse(
            a.getId(), a.getTitle(), a.getExcerpt(), a.getBody(),
            a.getCategory(),
            a.getOrganization() != null ? a.getOrganization().getSlug() : null,
            a.getAuthor(), a.getPublishedAt(), a.getReadingTime(),
            a.isFeatured(), a.getColorScheme(), a.getCoverImage(),
            a.getStatus(), a.getCreatedAt(), a.getUpdatedAt()
        );
    }
}
