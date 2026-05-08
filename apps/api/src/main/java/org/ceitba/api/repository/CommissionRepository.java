package org.ceitba.api.repository;

import org.ceitba.api.domain.Commission;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

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
}
