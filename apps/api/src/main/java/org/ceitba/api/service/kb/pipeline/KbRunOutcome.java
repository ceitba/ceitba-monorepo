package org.ceitba.api.service.kb.pipeline;

// Final status of a run that reached its end (pipeline: its subjects; eval:
// its configurations): FAILED when every one failed, PARTIAL when some did,
// SUCCEEDED otherwise (including when there was nothing to do).
public final class KbRunOutcome {

    private KbRunOutcome() {}

    public static String status(long total, long failed) {
        if (total <= 0 || failed <= 0) return "SUCCEEDED";
        return failed >= total ? "FAILED" : "PARTIAL";
    }

    // partial: ones that finished with only part of their work (e.g. a
    // subject published with rejected pages): the run is at least PARTIAL.
    public static String status(long total, long failed, long partial) {
        var base = status(total, failed);
        return base.equals("SUCCEEDED") && partial > 0 ? "PARTIAL" : base;
    }

    // SUCCEEDED or PARTIAL: the run finished and produced something.
    public static boolean completed(String status) {
        return "SUCCEEDED".equals(status) || "PARTIAL".equals(status);
    }
}
