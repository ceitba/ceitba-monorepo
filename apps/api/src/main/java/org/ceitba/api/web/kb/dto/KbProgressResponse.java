package org.ceitba.api.web.kb.dto;

import java.time.OffsetDateTime;
import java.util.List;

// Progress of a pipeline run or an eval (docs/SUBJECT-WIKI-ADMIN.md, "Progress").
//   stages   DIGEST, PLAN, WRITE, RETRY, LINK, VALIDATE, PUBLISH; status
//            pending | running | waiting_batch | done | failed | skipped
//            (waiting_batch includes a batch whose creation DO rate-limited);
//            counts are requests (LINK/VALIDATE: pages, PUBLISH: subjects);
//            total is null while unknown (WRITE until PLAN is done, RETRY
//            until WRITE is done)
//   overall  in estimated tokens (each request weighted by its expected
//            input tokens), percent 0-100
//   etaSec   sync only: remaining requests x moving average latency /
//            concurrency; null for batch or without data
//   stalled  no activity for 10 min (sync) or 26 h (batch) while active
public record KbProgressResponse(List<Stage> stages, Overall overall, String current, Long etaSec,
                                 OffsetDateTime lastActivityAt, boolean stalled) {

    public record Stage(String stage, String status, Integer total, int done, int failed, int inFlight, String mode,
                        Batch batch, OffsetDateTime startedAt, OffsetDateTime finishedAt) {}

    // status: the job's (QUEUED until DO accepts it, SUBMITTED, COMPLETED,
    // FAILED, CANCELLED); error: DO's error_message of a failed batch, or why
    // creation is being retried (RATE_LIMITED: ... / UNAVAILABLE: ...) with
    // nextAttemptAt.
    public record Batch(String doStatus, RequestCounts requestCounts, OffsetDateTime submittedAt, String status,
                        String error, OffsetDateTime nextAttemptAt) {}

    public record RequestCounts(int total, int completed, int failed) {}

    public record Overall(long done, long total, double percent) {}
}
