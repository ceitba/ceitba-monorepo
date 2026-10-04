package org.ceitba.api.service.kb.pipeline;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.domain.kb.KbBatchJob;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.domain.kb.KbRun;
import org.ceitba.api.domain.kb.KbRunRequest;
import org.ceitba.api.external.llm.FakeLlmBatchClient;
import org.ceitba.api.external.llm.FakeSyncChatClient;
import org.ceitba.api.external.llm.LlmApiException;
import org.ceitba.api.repository.kb.KbBatchJobRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.repository.kb.KbRunRepository;
import org.ceitba.api.repository.kb.KbRunRequestRepository;
import org.ceitba.api.service.kb.InMemoryRepo;
import org.ceitba.api.service.kb.NoTx;
import org.ceitba.api.service.kb.llm.BatchLlmExecutor;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

// Idempotent DO batch submission and the 429 back-off (no DB: in-memory
// repositories enforcing the (run, stage, attempt, model) unique index).
class KbBatchSubmitterTest {

    static final String MODEL = "openai-gpt-6-luna";
    static final String RATE_LIMIT = "POST /v1/batches -> 429: {\"error\":{\"message\":\"Rate limit exceeded: "
        + "batch_create_per_minute, batch_creations_per_hour.\",\"type\":\"rate_limit_exceeded_error\"}}";

    final ObjectMapper json = new ObjectMapper();
    final FakeLlmBatchClient fake = new FakeLlmBatchClient(json);
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-03T06:25:45Z"));
    final UUID runId = UUID.randomUUID();
    InMemoryRepo<KbBatchJob, UUID> jobs;
    InMemoryRepo<KbRunRequest, String> requests;
    InMemoryRepo<KbModel, String> models;
    KbBatchSubmitter submitter;

    @BeforeEach
    void setUp() {
        jobs = new InMemoryRepo<KbBatchJob, UUID>(KbBatchJob::getId).beforeSave(j -> {
            if (j.getId() != null) return j;
            boolean dup = jobs.rows.values().stream().anyMatch(o -> o.getRunId().equals(j.getRunId())
                && o.getStage().equals(j.getStage()) && o.getAttempt() == j.getAttempt()
                && o.getModel().equals(j.getModel()) && o.getPart() == j.getPart());
            if (dup) throw new DataIntegrityViolationException("kb_batch_job_once_idx");
            ReflectionTestUtils.setField(j, "id", UUID.randomUUID());
            return j;
        });
        requests = new InMemoryRepo<>(KbRunRequest::getCustomId);
        requests.on("submittedIdsOfJob", a -> requests.all().stream()
            .filter(r -> a[0].equals(r.getBatchJobId()) && r.getStatus().equals("SUBMITTED"))
            .map(KbRunRequest::getCustomId).sorted().toList());
        requests.on("markSubmitted", a -> {
            for (var id : (java.util.Collection<String>) a[1]) requests.rows.get(id).submitted((UUID) a[0]);
            return 0;
        });
        requests.on("failSubmittedOfJob", a -> {
            requests.all().stream().filter(r -> a[0].equals(r.getBatchJobId()) && r.getStatus().equals("SUBMITTED"))
                .forEach(r -> r.failed((String) a[1]));
            return 0;
        });
        models = new InMemoryRepo<>(KbModel::getId);
        var runs = new InMemoryRepo<KbRun, UUID>(KbRun::getId).on("setStatusIf", a -> 0);
        var router = new KbLlmRouter(fake, new FakeSyncChatClient(json),
            new KbLlmProperties(null, null, "auto", 4, true), models.as(KbModelRepository.class));
        submitter = new KbBatchSubmitter(jobs.as(KbBatchJobRepository.class), requests.as(KbRunRequestRepository.class),
            runs.as(KbRunRepository.class), new BatchLlmExecutor(fake, json), router, NoTx.template(), clock);
        for (int i = 1; i <= 2; i++) {
            var params = json.createObjectNode().put("model", MODEL).put("max_tokens", 100).put("system", "s");
            params.putArray("messages").addObject().put("role", "user").put("content", "hola");
            var id = "abcd1234-D-00000" + i;
            requests.rows.put(id, new KbRunRequest(id, runId, "DIGEST", "93.41", runId + ":DIGEST:93.41:f" + i, "f" + i,
                0, MODEL, params, 10));
        }
    }

    List<String> ids() {
        return List.copyOf(requests.rows.keySet());
    }

    @Test
    void theSameStageQueuedTwiceIsSubmittedOnce() {
        var job = submitter.queue(runId, "DIGEST", 1, MODEL, ids(), "kb/runs/x/digest.jsonl");
        assertThat(job.getStatus()).isEqualTo("QUEUED");
        assertThat(job.getDoRequestId()).isEqualTo(runId + ":DIGEST:1:" + MODEL);
        assertThat(submitter.submitQueued(job.getId())).isEqualTo(KbBatchSubmitter.Outcome.SUBMITTED);

        // A second advancer (kick vs poller) reaches the same stage: the row exists, nothing is sent.
        assertThat(submitter.queue(runId, "DIGEST", 1, MODEL, ids(), "kb/runs/x/digest.jsonl")).isNull();
        assertThat(submitter.submitQueued(job.getId())).isEqualTo(KbBatchSubmitter.Outcome.SUBMITTED);
        assertThat(fake.createCalls()).isEqualTo(1);
        assertThat(fake.batchCount()).isEqualTo(1);
        assertThat(jobs.rows).hasSize(1);
        assertThat(jobs.all().get(0).getDoBatchId()).isNotNull();
        // The JSONL carries DO's batch id (native), not the catalog id.
        assertThat(fake.submitted()).extracting(r -> r.model()).containsOnly("gpt-6-luna");
    }

    @Test
    void rateLimitedCreationWaitsWithBackoffAndNeverFails() {
        for (int i = 0; i < 6; i++) fake.failNextCreate(new LlmApiException(429, RATE_LIMIT));
        var job = submitter.queue(runId, "DIGEST", 1, MODEL, ids(), "kb/runs/x/digest.jsonl");
        // batch_creations_per_hour: refused attempts count, so always a full hour.
        var expectedWaits = List.of(60, 60, 60, 60, 60, 60);
        for (int i = 0; i < expectedWaits.size(); i++) {
            var start = clock.now();
            assertThat(submitter.submitQueued(job.getId())).isEqualTo(KbBatchSubmitter.Outcome.WAITING);
            var j = jobs.rows.get(job.getId());
            assertThat(j.getStatus()).isEqualTo("QUEUED");
            assertThat(j.getError()).startsWith("RATE_LIMITED: ").contains("batch_creations_per_hour");
            assertThat(j.getNextAttemptAt()).isEqualTo(start.plusMinutes(expectedWaits.get(i)));
            // Not due yet: DO is not called again.
            int calls = fake.createCalls();
            clock.advance(Duration.ofSeconds(30));
            assertThat(submitter.submitQueued(job.getId())).isEqualTo(KbBatchSubmitter.Outcome.WAITING);
            assertThat(fake.createCalls()).isEqualTo(calls);
            clock.set(j.getNextAttemptAt());
        }
        assertThat(submitter.submitQueued(job.getId())).isEqualTo(KbBatchSubmitter.Outcome.SUBMITTED);
        var j = jobs.rows.get(job.getId());
        assertThat(j.getStatus()).isEqualTo("SUBMITTED");
        assertThat(j.getNextAttemptAt()).isNull();
        assertThat(j.getError()).isNull();
        assertThat(fake.createCalls()).isEqualTo(7);
    }

    @Test
    void aStageOverTheBatchCapIsSplitIntoPartsWithOwnJobsAndRequestIds() {
        var ids = java.util.stream.IntStream.rangeClosed(1, 12).mapToObj(i -> "id" + i).toList();
        var parts = KbBatchSubmitter.split(ids, 5);
        assertThat(parts).extracting(List::size).containsExactly(5, 5, 2);
        // Part 1 keeps the pre-split request id; later parts are distinct (unique per part).
        assertThat(KbBatchSubmitter.requestId(runId, "DIGEST", 1, MODEL, 1))
            .isEqualTo(KbBatchSubmitter.requestId(runId, "DIGEST", 1, MODEL));
        var first = submitter.queue(runId, "DIGEST", 1, MODEL, 1, List.of("abcd1234-D-000001"), "kb/runs/x/digest-p1.jsonl");
        var second = submitter.queue(runId, "DIGEST", 1, MODEL, 2, List.of("abcd1234-D-000002"), "kb/runs/x/digest-p2.jsonl");
        assertThat(second).isNotNull();
        assertThat(second.getDoRequestId()).isEqualTo(first.getDoRequestId() + ":p2");
        assertThat(jobs.rows).hasSize(2);
    }

    @Test
    void backoffIsOneFiveFifteenThenHourly() {
        assertThat(List.of(1, 2, 3, 4, 5, 9).stream().map(KbBatchSubmitter::backoff).map(Duration::toMinutes))
            .containsExactly(1L, 5L, 15L, 60L, 60L, 60L);
    }

    @Test
    void aCreationThatWentThroughIsAdoptedInsteadOfResubmitted() {
        var job = submitter.queue(runId, "DIGEST", 1, MODEL, ids(), "kb/runs/x/digest.jsonl");
        // First creation reached DO but the answer was lost (no response).
        fake.failNextCreate(new LlmApiException(0, "POST /v1/batches: timeout"));
        assertThat(submitter.submitQueued(job.getId())).isEqualTo(KbBatchSubmitter.Outcome.WAITING);
        // Simulate DO having it anyway, under the same request_id.
        var file = fake.createFile("x");
        fake.upload(file.uploadUrl(), "{\"custom_id\":\"a\",\"params\":{}}\n".getBytes());
        var created = fake.createBatch(file.fileId(), job.getDoRequestId(), "openai", null);
        clock.advance(Duration.ofMinutes(1));
        int calls = fake.createCalls();
        assertThat(submitter.submitQueued(job.getId())).isEqualTo(KbBatchSubmitter.Outcome.SUBMITTED);
        assertThat(fake.createCalls()).isEqualTo(calls);
        assertThat(jobs.rows.get(job.getId()).getDoBatchId()).isEqualTo(created.id());
    }

    @Test
    void aRejectedCreationFailsTheJobAndItsRequestsWithDoMessage() {
        fake.failNextCreate(new LlmApiException(400, "POST /v1/batches -> 400: invalid completion_window"));
        var job = submitter.queue(runId, "DIGEST", 1, MODEL, ids(), "kb/runs/x/digest.jsonl");
        assertThat(submitter.submitQueued(job.getId())).isEqualTo(KbBatchSubmitter.Outcome.FAILED);
        assertThat(jobs.rows.get(job.getId()).getStatus()).isEqualTo("FAILED");
        assertThat(jobs.rows.get(job.getId()).getError()).contains("invalid completion_window");
        assertThat(requests.all()).allSatisfy(r -> {
            assertThat(r.getStatus()).isEqualTo("FAILED");
            assertThat(r.getError()).contains("invalid completion_window");
        });
    }

    static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        OffsetDateTime now() {
            return OffsetDateTime.ofInstant(now, ZoneOffset.UTC);
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        void set(OffsetDateTime t) {
            now = t.toInstant();
        }

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
