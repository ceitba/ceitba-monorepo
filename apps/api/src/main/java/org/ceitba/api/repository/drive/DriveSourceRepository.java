package org.ceitba.api.repository.drive;

import org.ceitba.api.domain.drive.DriveSource;
import org.ceitba.api.domain.drive.DriveSourceStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DriveSourceRepository extends JpaRepository<DriveSource, UUID> {

    List<DriveSource> findByUserIdAndStatusNotOrderByCreatedAtDesc(UUID userId, DriveSourceStatus status);

    Optional<DriveSource> findByIdAndUserId(UUID id, UUID userId);

    Optional<DriveSource> findFirstByUserIdAndRootFolderIdAndStatusNot(UUID userId, String rootFolderId,
                                                                       DriveSourceStatus status);

    boolean existsByUserIdAndStatus(UUID userId, DriveSourceStatus status);

    // The job's queue: never-synced first, then oldest sync. Community
    // archive roots are never walked themselves (DriveCommunityService).
    @Query("""
        select s.id from DriveSource s where s.status in :statuses
          and s.kind <> org.ceitba.api.domain.drive.DriveSourceKind.COMMUNITY_ROOT
        order by s.lastSyncedAt asc nulls first, s.createdAt asc
        """)
    List<UUID> findIdsToSync(@Param("statuses") Collection<DriveSourceStatus> statuses);

    @Query("select s.rootFolderId from DriveSource s where s.status <> :excluded")
    List<String> findRootFolderIdsWithStatusNot(@Param("excluded") DriveSourceStatus excluded);

    Page<DriveSource> findByStatusOrderByCreatedAtDesc(DriveSourceStatus status, Pageable pageable);

    Page<DriveSource> findByStatusNotOrderByCreatedAtDesc(DriveSourceStatus status, Pageable pageable);

    List<DriveSource> findByUserId(UUID userId);

    List<DriveSource> findByKindAndStatus(org.ceitba.api.domain.drive.DriveSourceKind kind, DriveSourceStatus status);

    List<DriveSource> findByParentSourceId(UUID parentSourceId);

    @Query("select s.id from DriveSource s where s.kind <> org.ceitba.api.domain.drive.DriveSourceKind.STUDENT")
    List<UUID> findCommunityIds();

    // Row lock: a sync writing into the source serializes with a concurrent
    // disconnect, block or account deletion (DriveSyncStore).
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from DriveSource s where s.id = :id")
    Optional<DriveSource> findByIdForUpdate(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from DriveSource s where s.userId = :userId")
    List<DriveSource> findByUserIdForUpdate(@Param("userId") UUID userId);

    @Query("select count(s) > 0 from DriveSource s where s.rootFolderId = :rootFolderId and s.status = :status")
    boolean existsByRootFolderIdAndStatus(@Param("rootFolderId") String rootFolderId,
                                          @Param("status") DriveSourceStatus status);
}
