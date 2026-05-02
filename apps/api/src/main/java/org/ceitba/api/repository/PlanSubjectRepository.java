package org.ceitba.api.repository;

import org.ceitba.api.domain.PlanSubject;
import org.ceitba.api.domain.PlanSubjectId;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PlanSubjectRepository extends JpaRepository<PlanSubject, PlanSubjectId> {

    List<PlanSubject> findByPlanId(String planId);

    List<PlanSubject> findBySubjectId(String subjectId);

    Optional<PlanSubject> findByPlanIdAndSubjectId(String planId, String subjectId);

    List<PlanSubject> findByPlanIdAndSection(String planId, String section);

    List<PlanSubject> findByPlanIdAndYear(String planId, int year);

    List<PlanSubject> findByPlanIdAndYearAndSemester(String planId, int year, int semester);
}
