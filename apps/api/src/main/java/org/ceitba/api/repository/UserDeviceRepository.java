package org.ceitba.api.repository;

import org.ceitba.api.domain.UserDevice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface UserDeviceRepository extends JpaRepository<UserDevice, String> {

    // Insert-or-update on the token PK in one statement, so two concurrent
    // registrations of the same token cannot fail on a duplicate key. A token
    // registered by a different user moves to them (created_at restarts).
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
        INSERT INTO public.user_devices (token, user_id, platform, app_version, created_at, last_seen_at)
        VALUES (:token, :userId, :platform, :appVersion, :now, :now)
        ON CONFLICT (token) DO UPDATE SET
            created_at   = CASE WHEN public.user_devices.user_id = EXCLUDED.user_id
                                THEN public.user_devices.created_at ELSE EXCLUDED.created_at END,
            user_id      = EXCLUDED.user_id,
            platform     = EXCLUDED.platform,
            app_version  = EXCLUDED.app_version,
            last_seen_at = EXCLUDED.last_seen_at
        """, nativeQuery = true)
    void upsert(@Param("token") String token, @Param("userId") UUID userId,
                @Param("platform") String platform, @Param("appVersion") String appVersion,
                @Param("now") OffsetDateTime now);

    List<UserDevice> findByUserIdOrderByLastSeenAtDesc(UUID userId);

    // Keeps the `keep` most recently seen devices of a user, deletes the rest.
    @Modifying
    @Query(value = """
        DELETE FROM public.user_devices
        WHERE user_id = :userId
          AND token NOT IN (SELECT token FROM public.user_devices
                            WHERE user_id = :userId
                            ORDER BY last_seen_at DESC, created_at DESC
                            LIMIT :keep)
        """, nativeQuery = true)
    int trimForUser(@Param("userId") UUID userId, @Param("keep") int keep);

    @Modifying
    @Query("DELETE FROM UserDevice d WHERE d.token = :token AND d.userId = :userId")
    int deleteByTokenAndUserId(@Param("token") String token, @Param("userId") UUID userId);

    // --- Push recipients -----------------------------------------------------

    @Query("SELECT d.token FROM UserDevice d WHERE d.userId IN :userIds")
    List<String> findTokensByUserIds(@Param("userIds") Collection<UUID> userIds);

    @Query(value = """
        SELECT d.token FROM public.user_devices d
        JOIN public.user_follows f ON f.user_id = d.user_id
        WHERE f.org_slug = :slug
        """, nativeQuery = true)
    List<String> findTokensOfOrgFollowers(@Param("slug") String orgSlug);

    @Query("SELECT d.token FROM UserDevice d")
    List<String> findAllTokens();

    // Own transaction: called by the push sender outside any service transaction.
    @Transactional
    @Modifying
    @Query("DELETE FROM UserDevice d WHERE d.token IN :tokens")
    int deleteByTokens(@Param("tokens") Collection<String> tokens);
}
