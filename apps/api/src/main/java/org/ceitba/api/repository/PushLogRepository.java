package org.ceitba.api.repository;

import org.ceitba.api.domain.PushLog;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;

public interface PushLogRepository extends JpaRepository<PushLog, Long> {

    // [pushes, devices targeted, devices reached] of an org since `since`.
    @Query(value = """
        SELECT count(*), coalesce(sum(targeted), 0), coalesce(sum(sent), 0)
        FROM public.push_log WHERE org_slug = :org AND created_at >= :since
        """, nativeQuery = true)
    List<Object[]> totalsForOrgSince(@Param("org") String org, @Param("since") OffsetDateTime since);
}
