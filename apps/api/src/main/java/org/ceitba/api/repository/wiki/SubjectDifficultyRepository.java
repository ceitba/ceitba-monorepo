package org.ceitba.api.repository.wiki;

import org.ceitba.api.domain.wiki.SubjectDifficulty;
import org.ceitba.api.domain.wiki.SubjectDifficultyId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SubjectDifficultyRepository extends JpaRepository<SubjectDifficulty, SubjectDifficultyId> {

    List<SubjectDifficulty> findBySubjectId(String subjectId);
}
