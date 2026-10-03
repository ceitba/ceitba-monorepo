package org.ceitba.api.repository.kb;

import org.ceitba.api.domain.kb.KbRun;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface KbRunRepository extends JpaRepository<KbRun, UUID> {

    List<KbRun> findByStatusIn(Collection<String> statuses);

    List<KbRun> findAllByOrderByStartedAtDesc(Pageable pageable);

    List<KbRun> findByTriggerNotOrderByStartedAtDesc(String trigger, Pageable pageable);

    List<KbRun> findByStatusInAndTriggerNot(Collection<String> statuses, String trigger);

    List<KbRun> findByStatusInAndTrigger(Collection<String> statuses, String trigger);
}
