package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbRun;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface KbRunRepository extends JpaRepository<KbRun, UUID> {

    List<KbRun> findByStatusIn(Collection<String> statuses);

    // Lease (V37): taken when free, expired or already ours; 1 = acquired.
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query(value = """
        UPDATE wiki.kb_run SET lease_owner = :owner, lease_until = :until
        WHERE id = :id AND (lease_owner IS NULL OR lease_until < :now OR lease_owner = :owner)
        """, nativeQuery = true)
    int takeLease(@org.springframework.data.repository.query.Param("id") UUID id,
                  @org.springframework.data.repository.query.Param("owner") String owner,
                  @org.springframework.data.repository.query.Param("until") java.time.OffsetDateTime until,
                  @org.springframework.data.repository.query.Param("now") java.time.OffsetDateTime now);

    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query(value = """
        UPDATE wiki.kb_run SET lease_owner = NULL, lease_until = NULL WHERE id = :id AND lease_owner = :owner
        """, nativeQuery = true)
    int releaseLease(@org.springframework.data.repository.query.Param("id") UUID id,
                     @org.springframework.data.repository.query.Param("owner") String owner);

    List<KbRun> findAllByOrderByStartedAtDesc(Pageable pageable);

    List<KbRun> findByTriggerNotOrderByStartedAtDesc(String trigger, Pageable pageable);

    List<KbRun> findByStatusInAndTriggerNot(Collection<String> statuses, String trigger);

    List<KbRun> findByStatusInAndTrigger(Collection<String> statuses, String trigger);
}
