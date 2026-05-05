package org.ceitba.api.repository;

import org.ceitba.api.domain.StaffMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.UUID;

public interface StaffMemberRepository extends JpaRepository<StaffMember, UUID> {

    List<StaffMember> findAllByYearOrderByDepartmentSlugAscDisplayOrderAscNameAsc(int year);

    @Query("SELECT DISTINCT s.year FROM StaffMember s ORDER BY s.year DESC")
    List<Integer> findDistinctYearsDesc();
}
