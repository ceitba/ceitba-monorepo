package org.ceitba.api.external.itba;

import org.ceitba.api.common.exception.ExternalApiException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

// Test/offline fake. Activated by `itba.api.use-fake=true`. Tests inject this
// directly and stage canned responses with stub*().
//
// Student lookups are deterministic and PII-free: out of the box only the
// synthetic DEMO_EMAIL is known (a Computer Engineering student on S10-Rev23,
// handy for local dev); every other email is "not in SGA". Tests add more with
// stubStudent() or simulate an outage with failStudentLookups().
@Component
@ConditionalOnProperty(name = "itba.api.use-fake", havingValue = "true")
public class FakeItbaApiClient implements ItbaApiClient {

    public static final String DEMO_EMAIL = "demo.student@itba.edu.ar";
    public static final StudentProjection DEMO_STUDENT =
        new StudentProjection(60001, "S", "Ingeniería en Informática", "S10-Rev23");

    private final Map<String, List<SubjectPlanProjection>> planResponses = new ConcurrentHashMap<>();
    private final List<CommissionProjection> commissions = new ArrayList<>();
    // email -> synthetic DNI, and synthetic DNI -> student. The "DNIs" are
    // opaque fake keys, never real document numbers.
    private final Map<String, String> people = new ConcurrentHashMap<>();
    private final Map<String, StudentProjection> students = new ConcurrentHashMap<>();
    private volatile boolean failStudentLookups;
    private final AtomicInteger failedStudentLookups = new AtomicInteger();

    public FakeItbaApiClient() {
        seedDemoStudent();
    }

    public void stubPlan(String planId, List<SubjectPlanProjection> entries) {
        planResponses.put(planId, List.copyOf(entries));
    }

    public void stubCommissions(List<CommissionProjection> entries) {
        commissions.clear();
        commissions.addAll(entries);
    }

    public void stubStudent(String email, StudentProjection student) {
        String key = "fake-" + email.toLowerCase();
        people.put(email.toLowerCase(), key);
        students.put(key, student);
    }

    public void failStudentLookups(boolean fail) {
        this.failStudentLookups = fail;
    }

    // How many lookups have thrown because of failStudentLookups(true); lets
    // tests wait for a background sync to actually hit the outage.
    public int failedStudentLookups() {
        return failedStudentLookups.get();
    }

    public void reset() {
        planResponses.clear();
        commissions.clear();
        people.clear();
        students.clear();
        failStudentLookups = false;
        failedStudentLookups.set(0);
        seedDemoStudent();
    }

    private void seedDemoStudent() {
        stubStudent(DEMO_EMAIL, DEMO_STUDENT);
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

    @Override
    public Optional<String> findDniByEmail(String email) {
        if (failStudentLookups) {
            failedStudentLookups.incrementAndGet();
            throw new ExternalApiException("ITBA (fake)", "findDniByEmail", null);
        }
        return email == null ? Optional.empty() : Optional.ofNullable(people.get(email.toLowerCase()));
    }

    @Override
    public Optional<StudentProjection> findStudentByDni(String dni) {
        if (failStudentLookups) {
            failedStudentLookups.incrementAndGet();
            throw new ExternalApiException("ITBA (fake)", "findStudentByDni", null);
        }
        return Optional.ofNullable(students.get(dni));
    }
}
