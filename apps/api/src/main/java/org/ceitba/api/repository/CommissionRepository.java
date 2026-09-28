package org.ceitba.api.repository;

import org.ceitba.api.domain.Commission;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface CommissionRepository extends JpaRepository<Commission, String> {

    List<Commission> findBySubjectCode(String subjectCode);

    // Hydrates `times` in the same query so callers that read commission
    // schedules don't trigger N+1 selects on commission_time. The /v1/subjects
    // endpoint streams every commission and reads c.getTimes() inline; without
    // this graph that's 1 + N selects per request.
    @EntityGraph(attributePaths = {"times"})
    @Query("SELECT c FROM Commission c")
    List<Commission> findAllWithTimes();

    // GET /v1/commissions?plan=: commissions of the plan's subjects that have
    // not ended yet, with times hydrated in the same query.
    @EntityGraph(attributePaths = {"times"})
    @Query("""
        SELECT DISTINCT c FROM Commission c
        WHERE c.courseEnd >= :today
          AND c.subjectCode IN (SELECT ps.subjectId FROM PlanSubject ps WHERE ps.planId = :planId)
        ORDER BY c.subjectCode, c.commissionName, c.id
        """)
    List<Commission> findCurrentByPlanWithTimes(@Param("planId") String planId,
                                                @Param("today") LocalDate today);
}
