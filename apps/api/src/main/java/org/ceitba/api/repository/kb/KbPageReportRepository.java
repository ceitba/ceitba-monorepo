package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbPageReport;
import org.ceitba.api.domain.kb.KbPageReportId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;

public interface KbPageReportRepository extends JpaRepository<KbPageReport, KbPageReportId> {

    long countByPageId(UUID pageId);

    boolean existsByPageIdAndUserId(UUID pageId, UUID userId);

    @Modifying
    @Query("delete from KbPageReport r where r.pageId = :pageId")
    int deleteByPageId(@Param("pageId") UUID pageId);
}
