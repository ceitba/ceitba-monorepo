package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.NewsEvent;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;

public interface NewsEventRepository extends JpaRepository<NewsEvent, String> {

    @Query("""
        SELECT e FROM NewsEvent e
        WHERE (:category IS NULL OR e.category = :category)
          AND (:organization IS NULL OR e.organization.slug = :organization)
          AND (:from IS NULL OR e.eventDate >= :from)
          AND (:to IS NULL OR e.eventDate <= :to)
        ORDER BY e.eventDate ASC
        """)
    Page<NewsEvent> findFiltered(
        @Param("category")     String category,
        @Param("organization") String organization,
        @Param("from")         LocalDate from,
        @Param("to")           LocalDate to,
        Pageable pageable
    );
}
