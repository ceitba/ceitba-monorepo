package org.ceitba.api.external.itba;

import java.util.List;

// Talks to the ITBA backend API. Returns domain-shaped projections (NOT JPA
// entities) so callers don't have to know about the wire format. Two impls:
// RestClientItbaApiClient (real) and a test fake.
//
// Only courseCommissions and careerPlans are used. The SGA people/student
// lookup (legajo, career, plan by email) was removed after ITBA revoked
// CEITBA's access to it in 2026-09 (every call returned 401).
public interface ItbaApiClient {

    List<SubjectPlanProjection> getSubjectsByPlan(String planId);

    List<CommissionProjection> getCommissions(CommissionQuery query);

    List<CommissionProjection> getCommissionsBySubject(String subjectCode, CommissionQuery query);
}
