package org.ceitba.api.external.itba;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Array;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// Test/offline fake. Activated by `itba.api.use-fake=true`. Tests inject this
// directly and stage canned responses with stub*().
//
// Local dev (`itba.api.fake-from-db=true`, ITBA_API_FAKE_FROM_DB): a plan
// nobody stubbed is read from the local plan_subject/subject tables instead,
// so data loaded with scripts/dev-seed.sql shows up in the scheduler.
@Component
@ConditionalOnProperty(name = "itba.api.use-fake", havingValue = "true")
public class FakeItbaApiClient implements ItbaApiClient {

    private final Map<String, List<SubjectPlanProjection>> planResponses = new ConcurrentHashMap<>();
    private final List<CommissionProjection> commissions = new ArrayList<>();
    // Non-null only with itba.api.fake-from-db=true.
    private JdbcTemplate jdbc;

    @Autowired
    void setDatabaseFallback(JdbcTemplate jdbc, @Value("${itba.api.fake-from-db:false}") boolean enabled) {
        this.jdbc = enabled ? jdbc : null;
    }

    public void stubPlan(String planId, List<SubjectPlanProjection> entries) {
        planResponses.put(planId, List.copyOf(entries));
    }

    public void stubCommissions(List<CommissionProjection> entries) {
        commissions.clear();
        commissions.addAll(entries);
    }

    public void reset() {
        planResponses.clear();
        commissions.clear();
    }

    @Override
    public List<SubjectPlanProjection> getSubjectsByPlan(String planId) {
        var stubbed = planResponses.get(planId);
        if (stubbed != null) return stubbed;
        if (jdbc == null) return List.of();
        return jdbc.query("""
            SELECT ps.subject_id, ps.plan_id, ps.section, ps.year, ps.semester, ps.dependencies,
                   ps.credits_required, s.name, s.credits
            FROM plan_subject ps JOIN subject s ON s.id = ps.subject_id
            WHERE ps.plan_id = ?
            ORDER BY ps.year, ps.semester, ps.subject_id
            """, (rs, i) -> new SubjectPlanProjection(
                rs.getString("subject_id"), rs.getString("plan_id"), rs.getString("section"),
                rs.getObject("year", Integer.class), rs.getObject("semester", Integer.class),
                toList(rs.getArray("dependencies")), rs.getObject("credits_required", Integer.class),
                rs.getString("name"), rs.getInt("credits")), planId);
    }

    private static List<String> toList(Array array) throws SQLException {
        return array == null ? List.of() : List.of((String[]) array.getArray());
    }

    @Override
    public List<CommissionProjection> getCommissions(CommissionQuery query) {
        return List.copyOf(commissions);
    }

    @Override
    public List<CommissionProjection> getCommissionsBySubject(String subjectCode, CommissionQuery query) {
        return commissions.stream()
            .filter(c -> subjectCode.equals(c.subjectCode()))
            .toList();
    }
}
