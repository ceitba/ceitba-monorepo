package org.ceitba.api.repository;

import org.ceitba.api.domain.SavedSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SavedScheduleRepository extends JpaRepository<SavedSchedule, UUID> {

    List<SavedSchedule> findByUserIdOrderByUpdatedAtDesc(UUID userId);

    // The primary schedule of each given user (at most one per user), for the
    // weekly digest's "Tu cuatrimestre".
    List<SavedSchedule> findByUserIdInAndPrimaryTrue(Collection<UUID> userIds);

    long countByUserId(UUID userId);

    Optional<SavedSchedule> findByIdAndUserId(UUID id, UUID userId);

    // Serializes a user's schedule writes that read-then-write the count or
    // the primary flag (create, makePrimary) until the transaction ends.
    // Without it, parallel first creates (the app's one-time local-schedules
    // upload) all see count 0 and all try is_primary = true, and the partial
    // unique index rejects all but one. Transaction-scoped advisory lock: no
    // row needs to exist, and it is released on commit or rollback.
    @Query(value = "SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext('saved_schedules:' || CAST(:userId AS text)))) l",
           nativeQuery = true)
    Integer lockUserSchedules(@Param("userId") UUID userId);

    // Clears the user's current primary (if any) other than `keepId`. Runs as
    // an immediate bulk UPDATE so the partial unique index never sees two
    // primaries when the new one is flushed afterwards.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update SavedSchedule s set s.primary = false "
         + "where s.userId = :userId and s.primary = true and s.id <> :keepId")
    int clearPrimaryExcept(@Param("userId") UUID userId, @Param("keepId") UUID keepId);
}
