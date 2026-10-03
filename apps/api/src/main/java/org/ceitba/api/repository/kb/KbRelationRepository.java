package org.ceitba.api.repository.kb;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Repository;

import java.util.List;

// wiki.kb_subject_relation (no entity: written in bulk, read as rows).
@Repository
public class KbRelationRepository {

    @PersistenceContext
    private EntityManager em;

    public record Relation(String relatedId, String reason, int weight) {}

    // PREREQUISITE (subject -> each of its dependencies) and DEPENDENT (the
    // reverse) from plan_subject.dependencies across all plans; weight =
    // number of plans. Callers own the transaction.
    public int refreshFromPlans() {
        em.createNativeQuery("DELETE FROM wiki.kb_subject_relation WHERE reason IN ('PREREQUISITE', 'DEPENDENT')")
            .executeUpdate();
        int n = em.createNativeQuery("""
                INSERT INTO wiki.kb_subject_relation (subject_id, related_id, reason, weight)
                SELECT ps.subject_id, d.dep, 'PREREQUISITE', count(DISTINCT ps.plan_id)
                FROM public.plan_subject ps
                CROSS JOIN LATERAL unnest(ps.dependencies) AS d(dep)
                JOIN public.subject s1 ON s1.id = ps.subject_id
                JOIN public.subject s2 ON s2.id = d.dep
                WHERE d.dep <> ps.subject_id
                GROUP BY ps.subject_id, d.dep
                """).executeUpdate();
        em.createNativeQuery("""
                INSERT INTO wiki.kb_subject_relation (subject_id, related_id, reason, weight)
                SELECT related_id, subject_id, 'DEPENDENT', weight
                FROM wiki.kb_subject_relation WHERE reason = 'PREREQUISITE'
                """).executeUpdate();
        return n;
    }

    @SuppressWarnings("unchecked")
    public List<Relation> findBySubject(String subjectId) {
        List<Object[]> rows = em.createNativeQuery("""
                SELECT related_id, reason, weight FROM wiki.kb_subject_relation
                WHERE subject_id = :s ORDER BY weight DESC, related_id
                """)
            .setParameter("s", subjectId)
            .getResultList();
        return rows.stream()
            .map(r -> new Relation((String) r[0], (String) r[1], ((Number) r[2]).intValue()))
            .toList();
    }
}
