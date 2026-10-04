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

    @Query("SELECT u FROM User u WHERE lower(u.email) IN :emails")
    List<User> findByLowerEmailIn(@Param("emails") Collection<String> emails);

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

    // Weekly digest audience (service/digest): followers of `orgSlug` (CEITBA)
    // who did not opt out. The domain guard is applied by the caller.
    @Query("""
        SELECT u FROM User u
        WHERE u.digestEmailEnabled = true
          AND EXISTS (SELECT 1 FROM UserFollow f WHERE f.userId = u.id AND f.organization = :orgSlug)
        ORDER BY u.id
        """)
    List<User> findDigestAudience(@Param("orgSlug") String orgSlug);

    // Size of the digest audience without loading it: same filter as
    // findDigestAudience plus the allowed-domain guard (DigestProperties.
    // isAllowedRecipient) done in SQL on the address's domain part.
    @Query("""
        SELECT COUNT(u) FROM User u
        WHERE u.digestEmailEnabled = true
          AND EXISTS (SELECT 1 FROM UserFollow f WHERE f.userId = u.id AND f.organization = :orgSlug)
          AND SUBSTRING(LOWER(TRIM(u.email)), LOCATE('@', TRIM(u.email)) + 1) IN :domains
        """)
    long countDigestAudience(@Param("orgSlug") String orgSlug, @Param("domains") java.util.Collection<String> domains);

    // countDigestAudience restricted to holders of `capability` (service/
    // capability rule: enabled_for_all OR active staff OR email grant OR
    // org-membership grant), in one query.
    @Query("""
        SELECT COUNT(u) FROM User u
        WHERE u.digestEmailEnabled = true
          AND EXISTS (SELECT 1 FROM UserFollow f WHERE f.userId = u.id AND f.organization = :orgSlug)
          AND SUBSTRING(LOWER(TRIM(u.email)), LOCATE('@', TRIM(u.email)) + 1) IN :domains
          AND (EXISTS (SELECT 1 FROM CapabilitySetting s WHERE s.capability = :capability AND s.enabledForAll = true)
            OR EXISTS (SELECT 1 FROM CeitbaStaff cs WHERE cs.userId = u.id AND cs.start <= :now AND cs.end >= :now)
            OR EXISTS (SELECT 1 FROM CapabilityUserGrant g WHERE g.capability = :capability AND g.email = LOWER(u.email))
            OR EXISTS (SELECT 1 FROM CapabilityOrgGrant og, UserOrganization m
                       WHERE og.capability = :capability AND m.organization = og.orgSlug AND m.userId = u.id))
        """)
    long countDigestAudienceWithCapability(@Param("orgSlug") String orgSlug,
                                           @Param("domains") java.util.Collection<String> domains,
                                           @Param("capability") String capability,
                                           @Param("now") java.time.OffsetDateTime now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE User u SET u.digestEmailEnabled = :enabled WHERE u.id = :id")
    int setDigestEmailEnabled(@Param("id") UUID id, @Param("enabled") boolean enabled);
}
