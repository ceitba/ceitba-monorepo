package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.EventRsvp;
import org.ceitba.api.domain.news.EventRsvpId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface EventRsvpRepository extends JpaRepository<EventRsvp, EventRsvpId> {

    long countByEventId(String eventId);

    boolean existsByEventIdAndUserId(String eventId, UUID userId);

    List<EventRsvp> findByEventIdOrderByCreatedAt(String eventId);

    @Query("SELECT r.eventId FROM EventRsvp r WHERE r.userId = :userId")
    List<String> findEventIdsByUserId(@Param("userId") UUID userId);

    @Query("SELECT r.userId FROM EventRsvp r WHERE r.eventId = :eventId")
    List<UUID> findUserIdsByEventId(@Param("eventId") String eventId);

    // [eventId, count] for each event with at least one RSVP.
    @Query("SELECT r.eventId, count(r) FROM EventRsvp r WHERE r.eventId IN :ids GROUP BY r.eventId")
    List<Object[]> countByEventIds(@Param("ids") Collection<String> ids);

    void deleteByEventIdAndUserId(String eventId, UUID userId);
}
