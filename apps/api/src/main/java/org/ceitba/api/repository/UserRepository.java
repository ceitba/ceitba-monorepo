package org.ceitba.api.repository;

import org.ceitba.api.domain.Career;
import org.ceitba.api.domain.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    Optional<User> findByFileNumber(Integer fileNumber);

    // Conditional single-column fills for the SGA prefill: each writes only
    // its own column and only while it is still NULL, so a concurrent profile
    // or staff edit is never overwritten. Return the number of rows changed.
    // The persistence context is flushed before and cleared after, so a User
    // already loaded in the request (open-in-view) is re-read, not stale.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE User u SET u.fileNumber = :fileNumber, u.updatedAt = :now WHERE u.id = :id AND u.fileNumber IS NULL")
    int fillFileNumberIfNull(@Param("id") UUID id, @Param("fileNumber") Integer fileNumber,
                             @Param("now") OffsetDateTime now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE User u SET u.career = :career, u.updatedAt = :now WHERE u.id = :id AND u.career IS NULL")
    int fillCareerIfNull(@Param("id") UUID id, @Param("career") Career career, @Param("now") OffsetDateTime now);

    // Plan only while the user's career is still `career`.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE User u SET u.plan = :plan, u.updatedAt = :now "
        + "WHERE u.id = :id AND u.plan IS NULL AND u.career = :career")
    int fillPlanIfNull(@Param("id") UUID id, @Param("career") Career career, @Param("plan") String plan,
                       @Param("now") OffsetDateTime now);

    // Records that SGA answered a lookup for this user (see
    // AcademicProfileSyncService.shouldSyncOnLogin). Touches no other column.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE User u SET u.sgaSyncedAt = :now WHERE u.id = :id")
    int markSgaSynced(@Param("id") UUID id, @Param("now") OffsetDateTime now);

    // Lowercased q matches name OR email substring; org filter joins
    // user_organization. Sort is supplied via the Pageable (so callers can
    // pick createdAt asc/desc without duplicating queries).
    //
    // `:q` is bound as an always-non-null lowercase string ("" means "match
    // anything") because Postgres can't infer the type of a null bind inside
    // `'%' || ? || '%'` and fails with `operator does not exist: text ~~ bytea`.
    @Query("""
        SELECT u FROM User u
        WHERE (LOWER(u.name)  LIKE CONCAT('%', :q, '%')
            OR LOWER(u.email) LIKE CONCAT('%', :q, '%'))
          AND (:organization IS NULL OR EXISTS (
                SELECT 1 FROM UserOrganization m
                WHERE m.userId = u.id AND m.organization = :organization))
        """)
    Page<User> findFiltered(
        @Param("q")            String q,
        @Param("organization") String organization,
        Pageable pageable
    );
}
