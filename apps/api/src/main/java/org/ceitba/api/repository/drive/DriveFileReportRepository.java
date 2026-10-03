package org.ceitba.api.repository.drive;

import org.ceitba.api.domain.drive.DriveFileReport;
import org.ceitba.api.domain.drive.DriveFileReportId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface DriveFileReportRepository extends JpaRepository<DriveFileReport, DriveFileReportId> {

    long countByFileId(UUID fileId);

    boolean existsByFileIdAndUserId(UUID fileId, UUID userId);

    List<DriveFileReport> findByFileIdInOrderByCreatedAtDesc(Collection<UUID> fileIds);

    @Query("select r.fileId from DriveFileReport r where r.userId = :userId")
    List<UUID> findFileIdsByUserId(@Param("userId") UUID userId);

    @Modifying
    @Query("delete from DriveFileReport r where r.fileId = :fileId")
    int deleteByFileId(@Param("fileId") UUID fileId);

    @Modifying
    @Query("delete from DriveFileReport r where r.userId = :userId")
    int deleteByUserId(@Param("userId") UUID userId);
}
