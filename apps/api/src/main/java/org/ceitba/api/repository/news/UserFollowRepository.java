package org.ceitba.api.repository.news;

import org.ceitba.api.domain.news.UserFollow;
import org.ceitba.api.domain.news.UserFollowId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface UserFollowRepository extends JpaRepository<UserFollow, UserFollowId> {

    List<UserFollow> findByUserId(UUID userId);

    List<UserFollow> findByOrganizationOrderByCreatedAtDesc(String organization);

    boolean existsByUserIdAndOrganization(UUID userId, String organization);

    long countByOrganization(String organization);

    void deleteByUserIdAndOrganization(UUID userId, String organization);

    // Current followers who followed before `since` (baseline of the
    // cumulative series; unfollows are not recorded).
    @Query(value = "SELECT count(*) FROM public.user_follows WHERE org_slug = :org AND created_at < :since",
           nativeQuery = true)
    long countFollowersBefore(@Param("org") String org, @Param("since") java.time.OffsetDateTime since);

    // [ART date, new follows] per day since `since`, of current followers.
    @Query(value = """
        SELECT (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS day, count(*)
        FROM public.user_follows WHERE org_slug = :org AND created_at >= :since
        GROUP BY 1 ORDER BY 1
        """, nativeQuery = true)
    java.util.List<Object[]> dailyNewFollowersSince(@Param("org") String org,
                                                    @Param("since") java.time.OffsetDateTime since);
}
