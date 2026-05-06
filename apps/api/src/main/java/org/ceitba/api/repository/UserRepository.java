package org.ceitba.api.repository;

import org.ceitba.api.domain.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    Optional<User> findByFileNumber(Integer fileNumber);

    // Lowercased q matches name OR email substring; org filter joins
    // user_organization. Sort is supplied via the Pageable (so callers can
    // pick createdAt asc/desc without duplicating queries).
    //
    // `:q` is bound as an always-non-null lowercase string ("" means "match
    // anything") because Postgres can't infer the type of a null bind inside
    // `'%' || ? || '%'` and fails with `operator does not exist: text ~~ bytea`.
    @Query("""
        SELECT u FROM User u
        WHERE (LOWER(u.name)  LIKE CONCAT('%', :q, '%')
            OR LOWER(u.email) LIKE CONCAT('%', :q, '%'))
          AND (:organization IS NULL OR EXISTS (
                SELECT 1 FROM UserOrganization m
                WHERE m.userId = u.id AND m.organization = :organization))
        """)
    Page<User> findFiltered(
        @Param("q")            String q,
        @Param("organization") String organization,
        Pageable pageable
    );
}
