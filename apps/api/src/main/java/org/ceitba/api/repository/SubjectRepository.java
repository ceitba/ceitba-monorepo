package org.ceitba.api.repository;

import org.ceitba.api.domain.Subject;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SubjectRepository extends JpaRepository<Subject, String> {

    List<Subject> findByNameContainingIgnoreCase(String name);
}
