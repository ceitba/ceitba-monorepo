package org.ceitba.api.repository;

import jakarta.persistence.LockModeType;
import org.ceitba.api.domain.RefreshToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    // family_id never changes, so it can be read before the family lock is
    // taken; a scalar keeps the entity out of the persistence context until
    // the locked re-read.
    @Query("SELECT t.familyId FROM RefreshToken t WHERE t.tokenHash = :hash")
    Optional<UUID> findFamilyIdByTokenHash(@Param("hash") String tokenHash);

    // Families of the user that still have a live token, in a stable order so
    // concurrent callers take the family locks in the same sequence.
    @Query("""
        SELECT DISTINCT t.familyId FROM RefreshToken t
        WHERE t.userId = :userId AND t.revokedAt IS NULL
        ORDER BY t.familyId
        """)
    List<UUID> findLiveFamilyIds(@Param("userId") UUID userId);

    // Transaction-scoped advisory lock on one family. Every path that issues
    // a successor into a family or revokes it takes this lock first, so a
    // revocation cannot miss a successor inserted by a concurrent rotation
    // that has not committed yet (row locks cannot cover rows that do not
    // exist yet). Released at commit/rollback.
    @Query(value = "SELECT count(*) FROM (SELECT pg_advisory_xact_lock(hashtext(CAST(:familyId AS text)))) l",
        nativeQuery = true)
    long lockFamily(@Param("familyId") UUID familyId);

    // Row lock so two concurrent refreshes with the same token serialize: the
    // second one sees the first's rotation and is treated as reuse.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM RefreshToken t WHERE t.tokenHash = :hash")
    Optional<RefreshToken> findByTokenHashForUpdate(@Param("hash") String tokenHash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM RefreshToken t WHERE t.id = :id")
    Optional<RefreshToken> findByIdForUpdate(@Param("id") UUID id);

    @Modifying
    @Query("UPDATE RefreshToken t SET t.revokedAt = :now WHERE t.familyId = :familyId AND t.revokedAt IS NULL")
    int revokeFamily(@Param("familyId") UUID familyId, @Param("now") OffsetDateTime now);

    @Modifying
    @Query("UPDATE RefreshToken t SET t.revokedAt = :now WHERE t.userId = :userId AND t.revokedAt IS NULL")
    int revokeAllForUser(@Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    @Modifying
    @Query("DELETE FROM RefreshToken t WHERE t.userId = :userId")
    int deleteAllForUser(@Param("userId") UUID userId);
}
