package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbRun;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface KbRunRepository extends JpaRepository<KbRun, UUID> {

    List<KbRun> findByStatusIn(Collection<String> statuses);

    // The run, row-locked until the transaction ends: status transitions
    // (finish, cancel, approve) read it this way so they serialize.
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select r from KbRun r where r.id = :id")
    java.util.Optional<KbRun> lockById(@org.springframework.data.repository.query.Param("id") UUID id);

    // Conditional status change (e.g. RUNNING <-> WAITING after an HTTP
    // call): never resurrects a cancelled or finished run. 1 = changed.
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query(
        "update KbRun r set r.status = :status where r.id = :id and r.status in :from")
    int setStatusIf(@org.springframework.data.repository.query.Param("id") UUID id,
                    @org.springframework.data.repository.query.Param("status") String status,
                    @org.springframework.data.repository.query.Param("from") Collection<String> from);

    java.util.Optional<KbRun> findFirstByTriggerOrderByStartedAtDesc(String trigger);

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

    // Restart-loop guard (V49): counts one startup resume. A new window starts
    // when none is open or the last one began before `cutoff`.
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query(value = """
        UPDATE wiki.kb_run SET
          resume_count = CASE WHEN resume_window_start IS NULL OR resume_window_start < :cutoff THEN 1 ELSE resume_count + 1 END,
          resume_window_start = CASE WHEN resume_window_start IS NULL OR resume_window_start < :cutoff THEN :now ELSE resume_window_start END
        WHERE id = :id
        """, nativeQuery = true)
    int countResume(@org.springframework.data.repository.query.Param("id") UUID id,
                    @org.springframework.data.repository.query.Param("now") java.time.OffsetDateTime now,
                    @org.springframework.data.repository.query.Param("cutoff") java.time.OffsetDateTime cutoff);

    @org.springframework.data.jpa.repository.Query(value = "SELECT resume_count FROM wiki.kb_run WHERE id = :id", nativeQuery = true)
    int resumeCount(@org.springframework.data.repository.query.Param("id") UUID id);

    // A stage finished: the run is making progress, forget earlier resumes.
    @org.springframework.data.jpa.repository.Modifying
    @org.springframework.data.jpa.repository.Query(value = """
        UPDATE wiki.kb_run SET resume_count = 0, resume_window_start = NULL WHERE id = :id AND resume_count <> 0
        """, nativeQuery = true)
    int resetResumes(@org.springframework.data.repository.query.Param("id") UUID id);
}
