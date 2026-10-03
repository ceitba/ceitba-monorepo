package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbRunSubject;
import org.ceitba.api.domain.kb.KbRunSubjectId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface KbRunSubjectRepository extends JpaRepository<KbRunSubject, KbRunSubjectId> {

    List<KbRunSubject> findByRunIdOrderByPriorityDescSubjectIdAsc(UUID runId);
}
