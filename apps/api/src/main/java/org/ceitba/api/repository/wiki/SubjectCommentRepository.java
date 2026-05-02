package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.SubjectComment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SubjectCommentRepository extends JpaRepository<SubjectComment, UUID> {

    List<SubjectComment> findBySubjectId(String subjectId);

    List<SubjectComment> findByUserId(UUID userId);
}
