package org.ceitba.api.external.itba;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// Test-only fake. Activated by `itba.api.use-fake=true`. Tests inject this
// directly and stage canned responses with stub*().
@Component
@ConditionalOnProperty(name = "itba.api.use-fake", havingValue = "true")
public class FakeItbaApiClient implements ItbaApiClient {

    private final Map<String, List<SubjectPlanProjection>> planResponses = new ConcurrentHashMap<>();
    private final List<CommissionProjection> commissions = new ArrayList<>();

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
        return planResponses.getOrDefault(planId, List.of());
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
