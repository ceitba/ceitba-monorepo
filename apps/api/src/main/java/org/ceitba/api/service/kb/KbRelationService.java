package org.ceitba.api.service.kb;

import org.ceitba.api.repository.kb.KbRelationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Recomputes wiki.kb_subject_relation (PREREQUISITE/DEPENDENT) from
// plan_subject.dependencies. Scheduled by scheduling/KbRelationJob.
@Service
public class KbRelationService {

    private final KbRelationRepository relations;

    public KbRelationService(KbRelationRepository relations) {
        this.relations = relations;
    }

    @Transactional
    public int refresh() {
        return relations.refreshFromPlans();
    }
}
