package org.ceitba.api.repository;

import org.ceitba.api.domain.CeitbaStaff;
import org.springframework.data.jpa.repository.JpaRepository;
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
}
