package org.ceitba.api.service.sync;

import com.fasterxml.jackson.annotation.JsonProperty;

// Result shape of /api/v1/sync/all. JSON keys are camelCase to match the
// existing NestJS response.
public final class DataSyncResult {

    private final Counters subjects = new Counters();
    @JsonProperty("subjectPlans")
    private final Counters subjectPlans = new Counters();
    private final Counters commissions = new Counters();
    private long totalProcessed;
    private long duration;

    public Counters subjects() { return subjects; }
    public Counters subjectPlans() { return subjectPlans; }
    public Counters commissions() { return commissions; }

    public long getTotalProcessed() { return totalProcessed; }
    public long getDuration() { return duration; }

    void finish(long durationMs) {
        this.duration = durationMs;
        this.totalProcessed = subjects.created + subjects.updated
            + subjectPlans.created + subjectPlans.updated
            + commissions.created + commissions.updated;
    }

    public static final class Counters {
        long created;
        long updated;
        long errors;

        public long getCreated() { return created; }
        public long getUpdated() { return updated; }
        public long getErrors() { return errors; }
    }
}
