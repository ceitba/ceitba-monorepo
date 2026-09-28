package org.ceitba.api.repository;

import org.ceitba.api.domain.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    Optional<User> findByFileNumber(Integer fileNumber);

    Optional<User> findByFirebaseUid(String firebaseUid);

    List<User> findByFirebaseUidIn(Collection<String> firebaseUids);

    // True when an account with this Firebase uid was deleted
    // (AccountDeletionRepository.recordDeletedFirebaseAccount).
    @Query(value = """
        SELECT EXISTS (SELECT 1 FROM public.deleted_firebase_accounts
                       WHERE firebase_uid_sha256 = encode(sha256(convert_to(:uid, 'UTF8')), 'hex'))
        """, nativeQuery = true)
    boolean isDeletedFirebaseAccount(@Param("uid") String firebaseUid);

    // Case-insensitive email match for imports, where the stored email may
    // differ in case from the source. Oldest row wins if several match.
    Optional<User> findFirstByEmailIgnoreCaseOrderByCreatedAtAsc(String email);

    // Self-service legajo (UserProfileService): writes file_number only while
    // it is still NULL, so two concurrent requests cannot both set it; the
    // loser gets 0 rows. A number held by another user fails on the unique
    // index user_file_number_key (DataIntegrityViolationException). The
    // persistence context is flushed before and cleared after, so a User
    // already loaded in the request (open-in-view) is re-read, not stale.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE User u SET u.fileNumber = :fileNumber, u.updatedAt = :now WHERE u.id = :id AND u.fileNumber IS NULL")
    int setFileNumberIfNull(@Param("id") UUID id, @Param("fileNumber") Integer fileNumber,
                            @Param("now") OffsetDateTime now);

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
