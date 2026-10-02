package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.SubjectBookmark;
import org.ceitba.api.domain.wiki.SubjectBookmarkId;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SubjectBookmarkRepository extends JpaRepository<SubjectBookmark, SubjectBookmarkId> {

    long countBySubjectId(String subjectId);

    boolean existsBySubjectIdAndUserId(String subjectId, java.util.UUID userId);

    void deleteBySubjectIdAndUserId(String subjectId, java.util.UUID userId);

    long countByUserId(java.util.UUID userId);

    java.util.List<SubjectBookmark> findByUserIdOrderByUpdatedAtDescSubjectIdAsc(java.util.UUID userId);
}
