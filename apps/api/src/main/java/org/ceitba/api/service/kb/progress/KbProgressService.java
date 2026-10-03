package org.ceitba.api.service.kb.progress;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.kb.KbRun;
import org.ceitba.api.repository.kb.KbBatchJobRepository;
import org.ceitba.api.repository.kb.KbEvalRepository;
import org.ceitba.api.repository.kb.KbEvalSetRepository;
import org.ceitba.api.repository.kb.KbRunRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.repository.kb.KbRunSubjectRepository;
import org.ceitba.api.service.kb.llm.SyncLlmExecutor;
import org.ceitba.api.web.kb.dto.KbProgressResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

// Progress of runs and evals (docs/SUBJECT-WIKI-ADMIN.md, "Progress"): one
// light query over the request rows (no payloads; completion time from
// kb_llm_usage for rows recorded before V36), the batch jobs and the run.
@Service
public class KbProgressService {

    private final KbRunRepository runs;
    private final KbRunRequestRepository requests;
    private final KbBatchJobRepository jobs;
    private final KbRunSubjectRepository runSubjects;
    private final KbEvalRepository evals;
    private final KbEvalSetRepository sets;
    private final SyncLlmExecutor sync;
    private final Clock clock;

    public KbProgressService(KbRunRepository runs, KbRunRequestRepository requests, KbBatchJobRepository jobs,
                             KbRunSubjectRepository runSubjects, KbEvalRepository evals, KbEvalSetRepository sets,
                             SyncLlmExecutor sync, Clock clock) {
        this.runs = runs;
        this.requests = requests;
        this.jobs = jobs;
        this.runSubjects = runSubjects;
        this.evals = evals;
        this.sets = sets;
        this.sync = sync;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public KbProgressResponse progress(UUID runId) {
        var run = runs.findById(runId).orElseThrow(() -> new ResourceNotFoundException("KbRun", runId.toString()));
        return KbProgressMath.compute(state(run), rows(runId), jobs(runId), sync.concurrency(), OffsetDateTime.now(clock));
    }

    @Transactional(readOnly = true)
    public List<KbProgressMath.Row> rows(UUID runId) {
        var out = new ArrayList<KbProgressMath.Row>();
        for (Object[] r : requests.progressRows(runId)) {
            out.add(new KbProgressMath.Row((String) r[0], (String) r[1], Boolean.TRUE.equals(r[2]),
                ((Number) r[3]).intValue(), (String) r[4], time(r[5]), time(r[6]),
                r[7] == null ? null : ((Number) r[7]).intValue(), (String) r[8], (String) r[9]));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public KbProgressMath.Run state(KbRun run) {
        int expectedPlan;
        int pubTotal = 0;
        int pubDone = 0;
        int pubFailed = 0;
        if (run.isEval()) {
            var eval = evals.findById(run.getId()).orElse(null);
            int configs = eval == null ? 0 : eval.getConfigs().size();
            int subjects = 0;
            if (eval != null) {
                var set = sets.findById(eval.getSetId()).orElse(null);
                if (set != null && set.getFrozenInputs() != null) {
                    for (var s : set.getSubjectIds()) if (!set.getFrozenInputs().path(s.asText()).isEmpty()) subjects++;
                }
            }
            expectedPlan = configs * subjects;
        } else {
            var subs = runSubjects.findByRunIdOrderByPriorityDescSubjectIdAsc(run.getId());
            expectedPlan = (int) subs.stream().filter(s -> !s.getStatus().equals("DEFERRED")).count();
            for (var s : subs) {
                if (List.of("DEFERRED", "DRY").contains(s.getStatus())) continue;
                pubTotal++;
                if (s.getStatus().equals("PUBLISHED")) pubDone++;
                if (s.getStatus().equals("FAILED")) pubFailed++;
            }
        }
        return new KbProgressMath.Run(run.isEval(), run.getStage(), run.getStatus(), run.isDryRun(), run.getStartedAt(),
            run.getFinishedAt(), run.getStageLog(), expectedPlan, pubTotal, pubDone, pubFailed, run.getError());
    }

    private List<KbProgressMath.Job> jobs(UUID runId) {
        return jobs.findByRunIdOrderByCreatedAtAsc(runId).stream().map(j -> {
            var c = j.getDoRequestCounts();
            boolean has = c != null && c.has("total");
            return new KbProgressMath.Job(j.getStage(), j.getMode(), j.getStatus(), j.getDoStatus(),
                has ? c.path("total").asInt() : null, has ? c.path("completed").asInt() : null,
                has ? c.path("failed").asInt() : null, j.getSubmittedAt(), j.getStatusChangedAt(), j.getCompletedAt());
        }).toList();
    }

    private static OffsetDateTime time(Object o) {
        if (o == null) return null;
        if (o instanceof OffsetDateTime t) return t;
        if (o instanceof java.time.Instant i) return i.atOffset(ZoneOffset.UTC);
        if (o instanceof java.sql.Timestamp ts) return ts.toInstant().atOffset(ZoneOffset.UTC);
        return OffsetDateTime.parse(o.toString());
    }
}
