package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface KbLinkRepository extends JpaRepository<KbLink, UUID> {

    List<KbLink> findByFromPageId(UUID fromPageId);

    List<KbLink> findByFromPageIdIn(Collection<UUID> fromPageIds);

    List<KbLink> findByToPageId(UUID toPageId);

    List<KbLink> findByToPageIdIn(Collection<UUID> toPageIds);

    List<KbLink> findByToSubjectId(String toSubjectId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from KbLink l where l.fromPageId = :pageId")
    int deleteByFromPageId(@Param("pageId") UUID pageId);

    // (Re)points every link from or to `subjectId` at the page it names, or
    // NULL when there is none: run after each import, so links into a
    // subject imported later resolve then.
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = """
        UPDATE wiki.kb_link l
        SET to_page_id = (SELECT p.id FROM wiki.kb_page p
                          WHERE p.subject_id = l.to_subject_id AND p.slug = l.to_slug)
        WHERE l.to_subject_id = :subjectId
           OR l.from_page_id IN (SELECT p.id FROM wiki.kb_page p WHERE p.subject_id = :subjectId)
        """, nativeQuery = true)
    int resolveForSubject(@Param("subjectId") String subjectId);
}
