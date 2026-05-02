package org.ceitba.api.repository;

import org.ceitba.api.domain.CommissionTime;
import org.ceitba.api.domain.CommissionTimeId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface CommissionTimeRepository extends JpaRepository<CommissionTime, CommissionTimeId> {

    // All distinct (building, classroom) pairs across the schedule. The "all
    // classrooms" view used by /v1/classrooms (no filter) and by-building.
    @Query("SELECT DISTINCT ct FROM CommissionTime ct ORDER BY ct.building, ct.classroom, ct.day, ct.hourFrom")
    List<CommissionTime> findAllOrdered();

    // Occupied = there's a commission_time row whose parent commission is
    // currently active (today between courseStart and courseEnd).
    @Query("""
        SELECT ct FROM CommissionTime ct
        JOIN ct.commission c
        WHERE c.courseStart <= :today AND c.courseEnd >= :today
        ORDER BY ct.building, ct.classroom, ct.day, ct.hourFrom
        """)
    List<CommissionTime> findActiveOrdered(@Param("today") LocalDate today);
}
