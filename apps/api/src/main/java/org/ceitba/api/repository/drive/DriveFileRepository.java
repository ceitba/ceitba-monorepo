package org.ceitba.api.repository.drive;

import org.ceitba.api.domain.drive.DriveFile;
import org.ceitba.api.domain.drive.DriveFileKind;
import org.ceitba.api.domain.drive.DrivePublication;
import org.ceitba.api.domain.drive.DriveSourceStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface DriveFileRepository extends JpaRepository<DriveFile, UUID> {

    List<DriveFile> findBySourceId(UUID sourceId);

    List<DriveFile> findBySourceIdIn(Collection<UUID> sourceIds);

    List<DriveFile> findBySourceIdAndKind(UUID sourceId, DriveFileKind kind);

    List<DriveFile> findBySourceIdInAndKind(Collection<UUID> sourceIds, DriveFileKind kind);

    List<DriveFile> findByEffectiveSubjectIdAndPublicationOrderByNameAsc(String subjectId,
                                                                         DrivePublication publication);

    List<DriveFile> findByPurgeAfterBefore(OffsetDateTime now);

    List<DriveFile> findByKindAndRemovedAtIsNull(DriveFileKind kind);

    // Rows of the same Drive item in the student's OTHER sources (cross-source moves).
    @Query("""
        select f from DriveFile f, DriveSource s
        where s.id = f.sourceId and s.userId = :userId and f.driveId = :driveId and f.sourceId <> :sourceId
        order by f.createdAt asc
        """)
    List<DriveFile> findInOtherSourcesOfUser(@Param("driveId") String driveId, @Param("userId") UUID userId,
                                             @Param("sourceId") UUID sourceId);

    // Other rows already holding a stored copy of this exact content.
    @Query("""
        select f from DriveFile f
        where f.driveId = :driveId and f.contentFingerprint = :fingerprint and f.id <> :excludedId
          and f.syncError is null
        order by f.updatedAt desc
        """)
    List<DriveFile> findContentHolders(@Param("driveId") String driveId, @Param("fingerprint") String fingerprint,
                                       @Param("excludedId") UUID excludedId);

    // Whether rows other than `excludedIds` still use the stored copy of
    // (driveId, fingerprint).
    @Query("""
        select count(f) from DriveFile f
        where f.driveId = :driveId and f.contentFingerprint = :fingerprint and f.id not in :excludedIds
        """)
    long countOtherHolders(@Param("driveId") String driveId, @Param("fingerprint") String fingerprint,
                           @Param("excludedIds") Collection<UUID> excludedIds);

    // Per-source counters for the Source DTO: [sourceId, files, published, needsReview].
    @Query("""
        select f.sourceId,
               sum(case when f.kind <> org.ceitba.api.domain.drive.DriveFileKind.FOLDER
                         and f.removedAt is null then 1 else 0 end),
               sum(case when f.publication = org.ceitba.api.domain.drive.DrivePublication.PUBLISHED
                        then 1 else 0 end),
               sum(case when f.publication = org.ceitba.api.domain.drive.DrivePublication.NEEDS_REVIEW
                        then 1 else 0 end)
        from DriveFile f where f.sourceId in :sourceIds group by f.sourceId
        """)
    List<Object[]> countsBySource(@Param("sourceIds") Collection<UUID> sourceIds);

    // [subjectId, publishedCount, lastUpdatedAt], most recently updated first.
    @Query("""
        select f.effectiveSubjectId, count(f), max(coalesce(f.driveModifiedAt, f.publishedAt))
        from DriveFile f
        where f.publication = org.ceitba.api.domain.drive.DrivePublication.PUBLISHED
          and f.effectiveSubjectId is not null
        group by f.effectiveSubjectId
        order by max(coalesce(f.driveModifiedAt, f.publishedAt)) desc nulls last
        """)
    List<Object[]> publishedSubjects(Pageable pageable);

    @Query("""
        select f.effectiveSubjectId, count(f), max(coalesce(f.driveModifiedAt, f.publishedAt))
        from DriveFile f
        where f.publication = org.ceitba.api.domain.drive.DrivePublication.PUBLISHED
          and f.effectiveSubjectId in :subjectIds
        group by f.effectiveSubjectId
        """)
    List<Object[]> publishedSubjectsIn(@Param("subjectIds") Collection<String> subjectIds);

    // Staff queue. Files of sources still PENDING_REVIEW are handled by
    // approving/blocking the source, so they are left out.
    @Query(value = """
        select f from DriveFile f, DriveSource s
        where s.id = f.sourceId and f.publication = :publication and s.status <> :excludedStatus
        order by f.updatedAt desc, f.id
        """,
        countQuery = """
        select count(f) from DriveFile f, DriveSource s
        where s.id = f.sourceId and f.publication = :publication and s.status <> :excludedStatus
        """)
    Page<DriveFile> findStaffQueue(@Param("publication") DrivePublication publication,
                                   @Param("excludedStatus") DriveSourceStatus excludedStatus,
                                   Pageable pageable);
}
