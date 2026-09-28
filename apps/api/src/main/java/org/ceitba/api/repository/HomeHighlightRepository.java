package org.ceitba.api.repository;

import org.ceitba.api.domain.HomeHighlight;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface HomeHighlightRepository extends JpaRepository<HomeHighlight, UUID> {

    // Public carousel: active and inside the optional [starts_at, ends_at) window.
    @Query("""
        SELECT h FROM HomeHighlight h
        WHERE h.active = true
          AND (h.startsAt IS NULL OR h.startsAt <= :now)
          AND (h.endsAt IS NULL OR h.endsAt > :now)
        ORDER BY h.position ASC, h.createdAt ASC
        """)
    List<HomeHighlight> findVisible(@Param("now") OffsetDateTime now);

    List<HomeHighlight> findAllByOrderByPositionAscCreatedAtAsc();
}
