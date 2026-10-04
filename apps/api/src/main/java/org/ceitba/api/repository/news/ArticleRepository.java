package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.Article;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface ArticleRepository extends JpaRepository<Article, String> {

    // Offset-paginated: the ORDER BY must be a strict total order, or rows
    // that tie on created_at can land on two pages (or none) as the planner
    // is free to return ties in any order per query. `id` breaks ties.
    @Query("""
        SELECT a FROM Article a
        WHERE (:category IS NULL OR a.category = :category)
          AND (:organization IS NULL OR a.organization.slug = :organization)
          AND (:status IS NULL OR a.status = :status)
          AND (:createdBy IS NULL OR a.createdBy.id = :createdBy)
        ORDER BY a.createdAt DESC, a.id DESC
        """)
    Page<Article> findFiltered(
        @Param("category")     String category,
        @Param("organization") String organization,
        @Param("status")       String status,
        @Param("createdBy")    UUID createdBy,
        Pageable pageable
    );

    boolean existsByIdAndCreatedById(String id, UUID createdBy);

    // Status of an independent (org-less) article written by `userId`; empty
    // when the article is missing, belongs to an org, or has another author.
    @Query("""
        SELECT a.status FROM Article a
        WHERE a.id = :id AND a.organization IS NULL AND a.createdBy.id = :userId
        """)
    Optional<String> findIndependentStatusOwnedBy(@Param("id") String id, @Param("userId") UUID userId);
}
