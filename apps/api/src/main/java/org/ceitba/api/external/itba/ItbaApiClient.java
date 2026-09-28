package org.ceitba.api.external.itba;

import java.util.List;
import java.util.Optional;

// Talks to the ITBA backend API. Returns domain-shaped projections (NOT JPA
// entities) so callers don't have to know about the wire format. Two impls:
// RestClientItbaApiClient (real) and a test fake.
public interface ItbaApiClient {

    List<SubjectPlanProjection> getSubjectsByPlan(String planId);

    List<CommissionProjection> getCommissions(CommissionQuery query);

    List<CommissionProjection> getCommissionsBySubject(String subjectCode, CommissionQuery query);

    // People lookup: the DNI of the person with this institutional email, or
    // empty when SGA does not know the email. The DNI is personal data: keep
    // it in memory only (never persist or log it).
    Optional<String> findDniByEmail(String email);

    // Student lookup by DNI; empty when the person is not a student.
    Optional<StudentProjection> findStudentByDni(String dni);

    // Both lookups chained, so callers never handle the DNI themselves.
    default Optional<StudentProjection> findStudentByEmail(String email) {
        return findDniByEmail(email).flatMap(this::findStudentByDni);
    }
}
