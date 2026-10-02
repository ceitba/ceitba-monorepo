package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.Article;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ArticleRepository extends JpaRepository<Article, String> {

    // Offset-paginated: the ORDER BY must be a strict total order, or rows
    // that tie on created_at can land on two pages (or none) as the planner
    // is free to return ties in any order per query. `id` breaks ties.
    @Query("""
        SELECT a FROM Article a
        WHERE (:category IS NULL OR a.category = :category)
          AND (:organization IS NULL OR a.organization.slug = :organization)
          AND (:status IS NULL OR a.status = :status)
        ORDER BY a.createdAt DESC, a.id DESC
        """)
    Page<Article> findFiltered(
        @Param("category")     String category,
        @Param("organization") String organization,
        @Param("status")       String status,
        Pageable pageable
    );
}
