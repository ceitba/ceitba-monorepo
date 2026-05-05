package org.ceitba.api.repository;

import org.ceitba.api.domain.StaffDepartment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface StaffDepartmentRepository extends JpaRepository<StaffDepartment, String> {
    List<StaffDepartment> findAllByOrderByDisplayOrderAsc();
}
