package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbPage;
import org.ceitba.api.domain.kb.KbPageStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface KbPageRepository extends JpaRepository<KbPage, UUID> {

    List<KbPage> findBySubjectId(String subjectId);

    Optional<KbPage> findBySubjectIdAndSlug(String subjectId, String slug);

    List<KbPage> findBySubjectIdAndStatusIn(String subjectId, Collection<KbPageStatus> statuses);

    Page<KbPage> findByStatusOrderByUpdatedAtDescIdAsc(KbPageStatus status, Pageable pageable);

    // Subjects (of `ids`) that have at least one page with one of `statuses`.
    @Query("select distinct p.subjectId from KbPage p where p.subjectId in :ids and p.status in :statuses")
    List<String> findSubjectIdsWithPages(@Param("ids") Collection<String> ids,
                                         @Param("statuses") Collection<KbPageStatus> statuses);

    // Projections without page bodies (forecast, change detection).
    @Query("select distinct p.subjectId from KbPage p where p.status <> :status")
    List<String> findSubjectIdsWithStatusNot(@Param("status") KbPageStatus status);

    // [subjectId, sources (UUID[])] of every page with one of `statuses`.
    @Query("select p.subjectId, p.sources from KbPage p where p.status in :statuses")
    List<Object[]> findSubjectSources(@Param("statuses") Collection<KbPageStatus> statuses);

    // Takedown: PUBLISHED pages citing any of the files. `ids` is a Postgres
    // array literal ("{uuid,uuid}"): JPQL has no array operators.
    @Query(value = """
        SELECT * FROM wiki.kb_page
        WHERE status = 'PUBLISHED' AND sources && CAST(:ids AS uuid[])
        """, nativeQuery = true)
    List<KbPage> findPublishedCitingAny(@Param("ids") String ids);
}
