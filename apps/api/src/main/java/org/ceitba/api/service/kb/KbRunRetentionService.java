package org.ceitba.api.service.kb;

import org.ceitba.api.repository.kb.KbBatchJobRepository;
import org.ceitba.api.service.media.ObjectStorage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.UUID;

// Retention of the pipeline's JSONL in object storage (kb/runs/<runId>/...):
// request payloads carry raw student text, so the objects of finished jobs
// of finished runs go after RETENTION (docs/SUBJECT-WIKI-PIPELINE.md,
// "Privacy"). The job's keys are cleared once its objects are deleted.
// Called nightly by KbRelationJob.
@Service
public class KbRunRetentionService {

    private static final Logger log = LoggerFactory.getLogger(KbRunRetentionService.class);

    static final Duration RETENTION = Duration.ofDays(30);
    static final int BATCH = 200;

    private final KbBatchJobRepository jobs;
    private final ObjectStorage storage;
    private final TransactionTemplate tx;
    private final Clock clock;

    public KbRunRetentionService(KbBatchJobRepository jobs, ObjectStorage storage, TransactionTemplate tx,
                                 Clock clock) {
        this.jobs = jobs;
        this.storage = storage;
        this.tx = tx;
        this.clock = clock;
    }

    // Returns the number of jobs whose objects were deleted. Stops at the
    // first storage failure (the next night retries).
    public int purgeExpired() {
        var before = OffsetDateTime.now(clock).minus(RETENTION);
        int purged = 0;
        while (true) {
            var rows = tx.execute(s -> jobs.expiredObjects(before, BATCH));
            if (rows == null || rows.isEmpty()) break;
            var done = new ArrayList<UUID>();
            for (var r : rows) {
                try {
                    for (var key : keysOf((String) r[1], (String) r[2])) storage.delete(key);
                    done.add((UUID) r[0]);
                } catch (RuntimeException e) {
                    log.warn("KB retention: could not delete the objects of job {}: {}", r[0], e.getMessage());
                    break;
                }
            }
            if (!done.isEmpty()) tx.executeWithoutResult(s -> jobs.clearObjectKeys(done));
            purged += done.size();
            if (done.size() < rows.size()) break;
        }
        if (purged > 0) log.info("KB retention: deleted the stored payloads of {} batch jobs", purged);
        return purged;
    }

    // Every object a job may have written (KbRunEngine): the payload, its
    // -out / -out-resumed / -err siblings and the recorded output.
    static LinkedHashSet<String> keysOf(String payloadKey, String outputKey) {
        var keys = new LinkedHashSet<String>();
        if (payloadKey != null) {
            keys.add(payloadKey);
            if (payloadKey.endsWith(".jsonl")) {
                var base = payloadKey.substring(0, payloadKey.length() - ".jsonl".length());
                keys.add(base + "-out.jsonl");
                keys.add(base + "-out-resumed.jsonl");
                keys.add(base + "-err.jsonl");
            }
        }
        if (outputKey != null) keys.add(outputKey);
        return keys;
    }
}
