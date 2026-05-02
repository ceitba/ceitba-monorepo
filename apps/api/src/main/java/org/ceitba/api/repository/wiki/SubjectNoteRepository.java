package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.SubjectNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface SubjectNoteRepository extends JpaRepository<SubjectNote, UUID> {

    List<SubjectNote> findBySubjectId(String subjectId);

    List<SubjectNote> findByUploaderId(UUID uploaderId);
}
