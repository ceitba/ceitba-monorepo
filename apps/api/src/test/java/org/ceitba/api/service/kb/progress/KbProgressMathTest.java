package org.ceitba.api.service.kb.progress;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.web.kb.dto.KbProgressResponse;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class KbProgressMathTest {

    static final OffsetDateTime T0 = OffsetDateTime.parse("2026-10-03T02:33:36Z");

    static KbProgressMath.Run run(boolean eval, String stage, String status, int expectedPlan) {
        return new KbProgressMath.Run(eval, stage, status, false, T0, null,
            new ObjectMapper().createObjectNode(), expectedPlan, 0, 0, 0, null);
    }

    static KbProgressMath.Row done(String stage, int i, Integer latencyMs) {
        return new KbProgressMath.Row(stage, "DONE", false, 5000, "glm-5.3-flash", T0, T0.plusSeconds(16L * (i + 1)),
            latencyMs, "t" + i, "93.39");
    }

    static KbProgressMath.Row submitted(String stage, int i) {
        return new KbProgressMath.Row(stage, "SUBMITTED", false, 5000, "glm-5.3-flash", T0, null, null, "t" + i, "93.39");
    }

    static KbProgressResponse.Stage stage(KbProgressResponse p, String s) {
        return p.stages().stream().filter(x -> x.stage().equals(s)).findFirst().orElseThrow();
    }

    @Test
    void syncDigestWithEtaFromLatencies() {
        var rows = new ArrayList<KbProgressMath.Row>();
        for (int i = 0; i < 7; i++) rows.add(done("DIGEST", i, 16_000));
        for (int i = 7; i < 11; i++) rows.add(submitted("DIGEST", i));
        var jobs = List.of(new KbProgressMath.Job("DIGEST", "SYNC", "SUBMITTED", null, null, null, null, T0, null, null));
        var now = T0.plusSeconds(120);
        var p = KbProgressMath.compute(run(true, "DIGEST", "RUNNING", 6), rows, jobs, 4, now);

        var digest = stage(p, "DIGEST");
        assertThat(digest.status()).isEqualTo("running");
        assertThat(digest.total()).isEqualTo(11);
        assertThat(digest.done()).isEqualTo(7);
        assertThat(digest.inFlight()).isEqualTo(4);
        assertThat(digest.mode()).isEqualTo("sync");
        assertThat(stage(p, "PLAN").status()).isEqualTo("pending");
        assertThat(stage(p, "PLAN").total()).isEqualTo(6);
        assertThat(stage(p, "WRITE").total()).isNull();       // por determinar
        assertThat(stage(p, "PUBLISH").status()).isEqualTo("skipped");   // evals never publish
        assertThat(p.current()).isEqualTo("Generando resúmenes de archivos (7/11) con glm-5.3-flash");
        // remaining: 4 digest + 6 plan + 24 write (6 x 4) + 4 retry (15%) = 38; x 16 s / 4 in flight
        assertThat(p.etaSec()).isEqualTo(152);
        assertThat(p.overall().percent()).isBetween(1.0, 50.0);
        assertThat(p.lastActivityAt()).isEqualTo(T0.plusSeconds(112));
        assertThat(p.stalled()).isFalse();
    }

    @Test
    void etaFallsBackToCompletionGapsWithoutLatencies() {
        var rows = new ArrayList<KbProgressMath.Row>();
        for (int i = 0; i < 3; i++) rows.add(done("PLAN", i, null));   // 16 s apart
        rows.add(submitted("PLAN", 3));
        var p = KbProgressMath.compute(run(false, "PLAN", "RUNNING", 4), rows, List.of(), 4, T0.plusSeconds(60));
        // remaining: 1 plan + 16 write (4 x 4) + 3 retry = 20, x 16 s gap
        assertThat(p.etaSec()).isEqualTo(320);
    }

    @Test
    void batchStageUsesDoRequestCounts() {
        var rows = new ArrayList<KbProgressMath.Row>();
        for (int i = 0; i < 10; i++) rows.add(submitted("WRITE", i));
        var jobs = List.of(new KbProgressMath.Job("WRITE", "BATCH", "SUBMITTED", "in_progress", 10, 6, 1,
            T0.plusSeconds(10), T0.plusSeconds(3600), null));
        var p = KbProgressMath.compute(run(false, "WRITE", "WAITING", 2), rows, jobs, 4, T0.plusSeconds(7200));
        var write = stage(p, "WRITE");
        assertThat(write.status()).isEqualTo("waiting_batch");
        assertThat(write.done()).isEqualTo(6);
        assertThat(write.failed()).isEqualTo(1);
        assertThat(write.inFlight()).isEqualTo(3);
        assertThat(write.batch().doStatus()).isEqualTo("in_progress");
        assertThat(write.batch().requestCounts().completed()).isEqualTo(6);
        assertThat(p.etaSec()).isNull();
        assertThat(p.current()).contains("(7/10)").contains("esperando el lote");
        assertThat(p.stalled()).isFalse();   // 2 h < 26 h for batch
        assertThat(stage(p, "DIGEST").status()).isEqualTo("skipped");
        assertThat(stage(p, "PLAN").status()).isEqualTo("skipped");
    }

    @Test
    void syncWithoutActivityForTenMinutesIsStalled() {
        var rows = List.of(done("WRITE", 0, 20_000), submitted("WRITE", 1));
        var p = KbProgressMath.compute(run(false, "WRITE", "RUNNING", 1), rows, List.of(), 4,
            T0.plusSeconds(16 + 11 * 60));
        assertThat(p.stalled()).isTrue();
    }

    @Test
    void succeededRunIsComplete() {
        var rows = List.of(done("DIGEST", 0, 1000), done("PLAN", 1, 1000), done("WRITE", 2, 1000));
        var r = new KbProgressMath.Run(false, "DONE", "SUCCEEDED", false, T0, T0.plusSeconds(100),
            new ObjectMapper().createObjectNode(), 1, 1, 1, 0, null);
        var p = KbProgressMath.compute(r, rows, List.of(), 4, T0.plusSeconds(200));
        assertThat(p.overall().percent()).isEqualTo(100.0);
        assertThat(stage(p, "RETRY").status()).isEqualTo("skipped");
        assertThat(stage(p, "WRITE").status()).isEqualTo("done");
        assertThat(stage(p, "LINK").status()).isEqualTo("done");
        assertThat(stage(p, "PUBLISH").status()).isEqualTo("done");
        assertThat(p.current()).isEqualTo("Terminado");
        assertThat(p.etaSec()).isNull();
    }

    @Test
    void cancelledRunHasNothingInFlight() {
        var rows = List.of(done("PLAN", 0, 1000), submitted("PLAN", 1));
        var p = KbProgressMath.compute(run(true, "PLAN", "CANCELLED", 2), rows, List.of(), 4, T0.plusSeconds(60));
        assertThat(stage(p, "PLAN").inFlight()).isZero();
        assertThat(stage(p, "PLAN").status()).isEqualTo("failed");
        assertThat(stage(p, "WRITE").status()).isEqualTo("skipped");
        assertThat(p.current()).isEqualTo("Cancelado");
        assertThat(p.etaSec()).isNull();
        assertThat(p.stalled()).isFalse();
    }
}
