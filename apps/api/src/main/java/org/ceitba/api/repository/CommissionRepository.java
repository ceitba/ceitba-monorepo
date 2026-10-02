package org.ceitba.api.repository;

import jakarta.persistence.LockModeType;
import org.ceitba.api.domain.Commission;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface CommissionRepository extends JpaRepository<Commission, String> {

    List<Commission> findBySubjectCode(String subjectCode);

    // SELECT ... FOR UPDATE on the commission row. Every write to its schedule
    // corrections (suggest, vote, staff review, sync expiry) takes this lock
    // first, so the applied/pending transitions and counters of one
    // commission are serialized.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT c FROM Commission c WHERE c.id = :id")
    Optional<Commission> findForUpdate(@Param("id") String id);

    // Hydrates `times` in the same query so callers that read commission
    // schedules don't trigger N+1 selects on commission_time. The /v1/subjects
    // endpoint streams every commission and reads c.getTimes() inline; without
    // this graph that's 1 + N selects per request.
    @EntityGraph(attributePaths = {"times"})
    @Query("SELECT c FROM Commission c")
    List<Commission> findAllWithTimes();

    // GET /v1/subjects?plan=: every synced commission (all terms) of the given
    // subjects, times hydrated in the same query. The table keeps past terms
    // (the sync upserts by ITBA id and never prunes), so callers must pick the
    // term they want — see CommissionTerms. Ordered so the
    // earliest-starting commission of a term comes first.
    // Explicitly transactional: declared query methods get no default
    // transaction, and the caller deliberately runs outside one.
    @Transactional(readOnly = true)
    @EntityGraph(attributePaths = {"times"})
    @Query("""
        SELECT c FROM Commission c
        WHERE c.subjectCode IN :subjectCodes
        ORDER BY c.subjectCode, c.courseStart, c.commissionName, c.id
        """)
    List<Commission> findBySubjectCodeInWithTimes(@Param("subjectCodes") Collection<String> subjectCodes);

    // Commissions by id with times hydrated (schedule-correction views).
    @EntityGraph(attributePaths = {"times"})
    @Query("SELECT DISTINCT c FROM Commission c WHERE c.id IN :ids")
    List<Commission> findByIdInWithTimes(@Param("ids") Collection<String> ids);

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
