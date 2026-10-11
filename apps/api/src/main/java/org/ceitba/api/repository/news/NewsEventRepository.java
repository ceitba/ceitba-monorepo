package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.NewsEvent;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.time.OffsetDateTime;
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

    // Weekly digest candidates (service/digest): every event on [from, to],
    // plus the ones created in [announcedFrom, announcedTo) that happen later.
    @Query("""
        SELECT e FROM NewsEvent e LEFT JOIN FETCH e.organization
        WHERE e.eventDate >= :from
          AND (e.eventDate <= :to
               OR (e.createdAt >= :announcedFrom AND e.createdAt < :announcedTo))
        ORDER BY e.eventDate ASC, e.startTime ASC, e.id ASC
        """)
    List<NewsEvent> findDigestCandidates(@Param("from") LocalDate from, @Param("to") LocalDate to,
                                         @Param("announcedFrom") OffsetDateTime announcedFrom,
                                         @Param("announcedTo") OffsetDateTime announcedTo);

    // Row-locked load for delete (an org member's delete re-checks membership under it).
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT e FROM NewsEvent e WHERE e.id = :id")
    Optional<NewsEvent> findByIdForUpdate(@Param("id") String id);

    // RSVP events on `date` whose day-before reminder has not gone out.
    @Query("""
        SELECT e.id FROM NewsEvent e
        WHERE e.signupMode = 'rsvp' AND e.eventDate = :date AND e.reminderSentAt IS NULL
        ORDER BY e.id
        """)
    List<String> findReminderDue(@Param("date") LocalDate date);

    // Claims the reminder: 1 if this call set reminder_sent_at, 0 if it was
    // already set (another run got it first).
    @Modifying
    @Query("UPDATE NewsEvent e SET e.reminderSentAt = :now WHERE e.id = :id AND e.reminderSentAt IS NULL")
    int claimReminder(@Param("id") String id, @Param("now") java.time.OffsetDateTime now);
}
