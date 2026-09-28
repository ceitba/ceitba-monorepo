package org.ceitba.api.repository;

import jakarta.persistence.LockModeType;
import org.ceitba.api.domain.CeitbaStaff;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public interface CeitbaStaffRepository extends JpaRepository<CeitbaStaff, UUID> {

    @Query("""
        SELECT (count(cs) > 0) FROM CeitbaStaff cs
        WHERE cs.userId = :userId AND cs.start <= :now AND cs.end >= :now
        """)
    boolean isActiveStaff(@Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    @Query("""
        SELECT cs FROM CeitbaStaff cs
        WHERE cs.start <= :now AND cs.end >= :now
        ORDER BY cs.userId
        """)
    List<CeitbaStaff> findAllActive(@Param("now") OffsetDateTime now);

    // Same rows as findAllActive, locked FOR UPDATE (in user order, so
    // concurrent callers lock in the same sequence). Used by the last-staff
    // guard of account deletion: a second deletion blocks until the first
    // commits and then no longer sees the deleted row.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
        SELECT cs FROM CeitbaStaff cs
        WHERE cs.start <= :now AND cs.end >= :now
        ORDER BY cs.userId
        """)
    List<CeitbaStaff> findAllActiveForUpdate(@Param("now") OffsetDateTime now);
}
