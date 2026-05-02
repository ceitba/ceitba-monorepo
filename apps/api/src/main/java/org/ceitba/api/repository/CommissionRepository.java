package org.ceitba.api.repository;

import org.ceitba.api.domain.Commission;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CommissionRepository extends JpaRepository<Commission, String> {

    List<Commission> findBySubjectCode(String subjectCode);
}
