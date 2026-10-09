package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.NewsEvent;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface NewsEventRepository extends JpaRepository<NewsEvent, String> {

    // Offset-paginated: several events share a date (and even a start time),
    // so start time and then `id` make the ORDER BY a strict total order;
    // otherwise ties could repeat or vanish across pages.
    @Query("""
        SELECT e FROM NewsEvent e
        LEFT JOIN e.organization o
        WHERE (:category IS NULL OR e.category = :category)
          AND (:organization IS NULL OR o.slug = :organization)
          AND e.eventDate >= :from
          AND e.eventDate <= :to
        ORDER BY e.eventDate ASC, e.startTime ASC, e.id ASC
        """)
    Page<NewsEvent> findFiltered(
        @Param("category")     String category,
        @Param("organization") String organization,
        @Param("from")         LocalDate from,
        @Param("to")           LocalDate to,
        Pageable pageable
    );

    // Weekly digest candidates (service/digest): every event on [from, to].
    @Query("""
        SELECT e FROM NewsEvent e LEFT JOIN FETCH e.organization
        WHERE e.eventDate >= :from AND e.eventDate <= :to
        ORDER BY e.eventDate ASC, e.startTime ASC, e.id ASC
        """)
    List<NewsEvent> findBetween(@Param("from") LocalDate from, @Param("to") LocalDate to);

    // Row-locked load for delete (an org member's delete re-checks membership under it).
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT e FROM NewsEvent e WHERE e.id = :id")
    Optional<NewsEvent> findByIdForUpdate(@Param("id") String id);
}
