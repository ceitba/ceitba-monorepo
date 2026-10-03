package org.ceitba.api.web.kb.pipeline;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

// Admin side (docs/SUBJECT-WIKI-ADMIN.md): settings validation, history and
// restore; catalog; forecast and stage cost; evals with frozen inputs that
// never publish, blind review, leaderboard and promote. Default env models
// (GLM, sync); the haiku eval config runs through the batch executor.
class KbAdminEvalIT extends KbPipelineAcceptanceIT {

    @Override
    String expectedMode() {
        return "SYNC";
    }

    void probed(String... models) {
        for (var m : models) {
            jdbc.update("UPDATE wiki.kb_model SET last_probe = '{\"ok\":true,\"mode\":\"sync\",\"toolCalling\":\"yes\"}'::jsonb "
                + "WHERE id = ?", m);
        }
    }

    @Test
    void settingsAreValidatedVersionedAndRestorable() throws Exception {
        jdbc.update("UPDATE wiki.kb_model SET last_probe = NULL");
        var err = call(put("/v1/staff/kb/settings"), "{\"modelPlan\": \"anthropic-claude-haiku-4.5\"}", 400);
        assertThat(err.toString()).contains("probe");
        call(put("/v1/staff/kb/settings"), "{\"modelPlan\": \"no-such-model\"}", 400);
        // gpt-oss has no batch support: batch mode is rejected.
        probed("openai-gpt-oss-120b", "anthropic-claude-haiku-4.5", "glm-5.3", "glm-5.3-flash");
        call(put("/v1/staff/kb/settings"), "{\"executionMode\": \"batch\", \"modelWrite\": \"openai-gpt-oss-120b\"}", 400);

        var updated = call(put("/v1/staff/kb/settings"),
            "{\"modelPlan\": \"anthropic-claude-haiku-4.5\", \"reasoningEffort\": {\"digest\": \"low\", \"plan\": null, "
                + "\"write\": \"high\", \"retry\": \"high\"}}", 200);
        assertThat(updated.path("costImpact").path("previous").path("basis").asText()).isEqualTo("corpus");
        assertThat(updated.path("costImpact").path("projected").has("includesBacklog")).isTrue();
        assertThat(updated.path("costImpact").has("projectedWeeklyAvgUsd")).isFalse();
        assertThat(updated.path("updatedByName").asText()).isEqualTo("Staff");
        assertThat(call(get("/v1/staff/kb/settings"), null, 200).path("costImpact").isNull()).isTrue();
        // Standard 5-field cron is accepted and returned as Spring's 6 fields.
        var cron = call(put("/v1/staff/kb/settings"), "{\"cron\": \"0 3 * * SUN\"}", 200);
        assertThat(cron.path("settings").path("cron").asText()).isEqualTo("0 0 3 * * SUN");
        call(put("/v1/staff/kb/settings"), "{\"cron\": \"every sunday\"}", 400);
        var settings = call(get("/v1/staff/kb/settings"), null, 200);
        assertThat(settings.toString()).contains("anthropic-claude-haiku-4.5");

        var preview = call(post("/v1/staff/kb/settings/preview"), "{\"modelWrite\": \"no-such-model\"}", 200);
        assertThat(preview.path("errors")).isNotEmpty();
        assertThat(preview.path("costImpact").has("previous")).isTrue();

        // History holds each saved version; restoring the first brings haiku back.
        call(put("/v1/staff/kb/settings"), "{\"modelPlan\": \"glm-5.3\"}", 200);
        assertThat(call(get("/v1/staff/kb/settings"), null, 200).path("settings").path("modelPlan").asText())
            .isEqualTo("glm-5.3");
        var history = call(get("/v1/staff/kb/settings/history"), null, 200);
        assertThat(history).hasSize(3);
        assertThat(history.get(0).path("changedByName").asText()).isEqualTo("Staff");
        var oldest = history.get(history.size() - 1).path("id").asText();
        call(post("/v1/staff/kb/settings/history/" + oldest + "/restore"), null, 200);
        assertThat(call(get("/v1/staff/kb/settings"), null, 200).path("settings").path("modelPlan").asText())
            .isEqualTo("anthropic-claude-haiku-4.5");
        assertThat(call(get("/v1/staff/kb/settings/history"), null, 200)).hasSize(4);
    }

    @Test
    void costsAcceptDateOnlyAndIsoDatetimeAndRejectGarbage() throws Exception {
        run();   // usage rows created now
        var today = java.time.LocalDate.now(org.ceitba.api.config.ClockConfig.ZONE).toString();
        var tomorrow = java.time.LocalDate.now(org.ceitba.api.config.ClockConfig.ZONE).plusDays(1).toString();
        var rows = call(get("/v1/staff/kb/costs?from=" + today + "&to=" + today + "&groupBy=model"), null, 200);
        assertThat(rows).isNotEmpty();
        assertThat(rows.get(0).path("key").asText()).isEqualTo(rows.get(0).path("model").asText());
        assertThat(call(get("/v1/staff/kb/costs?from=" + tomorrow + "&to=" + tomorrow), null, 200)).isEmpty();
        var weekly = call(get("/v1/staff/kb/costs?from=" + today + "&groupBy=week,stage"), null, 200);
        assertThat(weekly.get(0).path("key").asText()).isEqualTo(weekly.get(0).path("week").asText() + "|"
            + weekly.get(0).path("stage").asText());
        var iso = java.time.OffsetDateTime.now().minusHours(1).toString();
        assertThat(call(get("/v1/staff/kb/costs").param("from", iso), null, 200)).isNotEmpty();
        assertThat(call(get("/v1/staff/kb/costs").param("from", today + "T00:00:00-03:00")
            .param("to", today + "T23:59:59.999-03:00"), null, 200)).isNotEmpty();
        for (var bad : new String[]{"2026-07-32", "11/07/2026", "nope"}) {
            var err = call(get("/v1/staff/kb/costs?from=" + bad), null, 400);
            assertThat(err.path("error").asText()).isEqualTo("ValidationError");
            assertThat(err.path("message").asText()).contains("from").doesNotContain("Failed to convert");
        }
        assertThat(call(get("/v1/staff/kb/costs?to=x"), null, 400).path("error").asText()).isEqualTo("ValidationError");
        call(get("/v1/staff/kb/costs?from=" + tomorrow + "&to=" + today), null, 400);
        // Other typed parameters: a clean ValidationError too.
        var uuid = call(get("/v1/staff/kb/evals/leaderboard?setId=not-a-uuid"), null, 400);
        assertThat(uuid.path("error").asText()).isEqualTo("ValidationError");
        assertThat(uuid.path("message").asText()).startsWith("setId:").doesNotContain("Failed to convert");
        assertThat(call(get("/v1/staff/kb/pipeline/runs?limit=abc"), null, 400).path("error").asText())
            .isEqualTo("ValidationError");
    }

    @org.springframework.beans.factory.annotation.Autowired org.ceitba.api.external.llm.DoModelCatalog doCatalog;

    @Test
    void modelSyncTakesPricesFromDoCatalogWithoutClobberingProbesOrManualFields() throws Exception {
        // The catalog rows are shared by every test of this context: restored afterwards.
        jdbc.execute("DROP TABLE IF EXISTS wiki.kb_model_backup");
        jdbc.execute("CREATE TABLE wiki.kb_model_backup AS SELECT * FROM wiki.kb_model");
        try {
            syncScenario();
        } finally {
            jdbc.execute("DELETE FROM wiki.kb_model");
            jdbc.execute("INSERT INTO wiki.kb_model SELECT * FROM wiki.kb_model_backup");
            jdbc.execute("DROP TABLE wiki.kb_model_backup");
            jdbc.update("DELETE FROM wiki.kb_pipeline_settings");
        }
    }

    void syncScenario() throws Exception {
        var fake = (org.ceitba.api.external.llm.FakeDoModelCatalog) doCatalog;
        // Unreachable catalog: falls back to /v1/models ids.
        fake.items(null);
        var fallback = call(post("/v1/staff/kb/models/sync"), null, 200);
        assertThat(fallback.path("source").asText()).isEqualTo("inference-models");

        var root = json.readTree(getClass().getResourceAsStream("/kb/do-model-catalog.json"));
        var items = new java.util.ArrayList<JsonNode>();
        root.path("data").forEach(items::add);
        fake.items(items);
        // Probe verdicts and manual fields that a sync must keep.
        jdbc.update("UPDATE wiki.kb_model SET input_per_m = 9, batch_supported = false, batch_source = 'probe', "
            + "batch_discount = 0.4, enabled = true, tool_calling = 'no', "
            + "last_probe = '{\"ok\":false,\"mode\":\"batch\"}'::jsonb WHERE id = 'anthropic-claude-haiku-4.5'");
        call(put("/v1/staff/kb/models/glm-5.3"), "{\"displayName\": \"GLM grande\"}", 200);
        jdbc.update("UPDATE wiki.kb_model SET input_per_m = 2.0 WHERE id = 'glm-5.3'");

        var res = call(post("/v1/staff/kb/models/sync"), null, 200);
        assertThat(res.path("source").asText()).isEqualTo("do-catalog");
        assertThat(res.path("fetchedAt").asText()).isNotBlank();
        assertThat(res.path("added").toString()).contains("kimi-k2.6").doesNotContain("dedicated-only-x", "some-embedding");
        assertThat(res.path("notInCatalog").toString()).contains("anthropic-claude-sonnet-5.5");
        JsonNode glmUpdate = null;
        for (var u : res.path("updated")) if (u.path("id").asText().equals("glm-5.3")) glmUpdate = u;
        assertThat(glmUpdate.toString()).contains("\"field\":\"inputPerM\"", "\"old\":\"2\"", "\"new\":\"1.4\"");

        var models = call(get("/v1/staff/kb/models"), null, 200);
        for (var m : models) {
            switch (m.path("id").asText()) {
                case "glm-5.3" -> {
                    assertThat(m.path("inputPerM").decimalValue()).isEqualByComparingTo("1.40");
                    assertThat(m.path("displayName").asText()).isEqualTo("GLM grande");   // manual kept
                    assertThat(m.path("priceSource").asText()).isEqualTo("do-catalog");
                    assertThat(m.path("maxOutputTokens").asInt()).isEqualTo(128000);
                }
                case "anthropic-claude-haiku-4.5" -> {
                    assertThat(m.path("inputPerM").decimalValue()).isEqualByComparingTo("1");
                    assertThat(m.path("batchSupported").asBoolean()).isFalse();
                    assertThat(m.path("batchSource").asText()).isEqualTo("probe");
                    assertThat(m.path("batchDiscount").decimalValue()).isEqualByComparingTo("0.4");
                    assertThat(m.path("enabled").asBoolean()).isTrue();
                    assertThat(m.path("toolCalling").asText()).isEqualTo("no");   // probe wins over hints
                }
                case "kimi-k2.6" -> {
                    assertThat(m.path("enabled").asBoolean()).isFalse();
                    assertThat(m.path("outputPerM").decimalValue()).isEqualByComparingTo("2.5");
                    assertThat(m.path("batchSupported").asBoolean()).isFalse();
                }
                default -> { }
            }
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_model_price_history WHERE model_id = 'glm-5.3' "
            + "AND field = 'inputPerM' AND source = 'do-catalog'", Integer.class)).isEqualTo(1);
        // A second sync changes nothing.
        var again = call(post("/v1/staff/kb/models/sync"), null, 200);
        assertThat(again.path("updated")).isEmpty();
        assertThat(again.path("unchanged").asInt()).isPositive();
        // The weekly refresh is a setting.
        var s = call(put("/v1/staff/kb/settings"), "{\"autoRefreshPrices\": false}", 200);
        assertThat(s.path("settings").path("autoRefreshPrices").asBoolean()).isFalse();
        assertThat(s.path("source").path("autoRefreshPrices").asText()).isEqualTo("db");
    }

    @Test
    void cancellingAnEvalCascades() throws Exception {
        probed("anthropic-claude-haiku-4.5", "glm-5.3", "glm-5.3-flash");
        var set = call(post("/v1/staff/kb/evals/sets"),
            "{\"name\": \"Cancelar\", \"subjectIds\": [\"" + FIN + "\", \"" + CONT + "\"]}", 201);
        // The haiku config runs through a batch that stays in progress.
        fakeBatch().hold(true);
        var models = "[{\"plan\": \"glm-5.3\", \"write\": \"glm-5.3\"}, "
            + "{\"plan\": \"anthropic-claude-haiku-4.5\", \"write\": \"anthropic-claude-haiku-4.5\"}]";
        var eval = call(post("/v1/staff/kb/evals"), "{\"setId\": \"" + set.path("id").asText() + "\", \"models\": "
            + models + "}", 202);
        var id = eval.path("id").asText();
        for (int i = 0; i < 3; i++) engine.advanceActive();
        var waiting = call(get("/v1/staff/kb/evals/" + id), null, 200);
        assertThat(waiting.path("status").asText()).isEqualTo("WAITING");
        var progress = call(get("/v1/staff/kb/evals/" + id + "/progress"), null, 200);
        assertThat(progress.toString()).contains("waiting_batch");

        var cancelled = call(post("/v1/staff/kb/evals/" + id + "/cancel"), null, 200);
        assertThat(cancelled.path("status").asText()).isEqualTo("CANCELLED");
        for (var c : cancelled.path("configs")) {
            assertThat(c.path("status").asText()).isEqualTo("CANCELLED");
            for (var s : c.path("perSubject")) assertThat(s.path("status").asText()).isEqualTo("cancelled");
        }
        assertThat(fakeBatch().cancelled()).isNotEmpty();   // DO cancel called for the open batch
        int sent = fakeBatch().submitted().size() + fakeSync().received().size();
        fakeBatch().hold(false);
        fakeBatch().release();
        engine.advanceActive();
        assertThat(fakeBatch().submitted().size() + fakeSync().received().size()).isEqualTo(sent);
        assertThat(call(get("/v1/staff/kb/evals/" + id), null, 200).path("status").asText()).isEqualTo("CANCELLED");
        assertThat(call(get("/v1/staff/kb/evals/" + id + "/progress"), null, 200).path("current").asText())
            .isEqualTo("Cancelado");
    }

    @Test
    void catalogForecastAndStageCost() throws Exception {
        var models = call(get("/v1/staff/kb/models"), null, 200);
        JsonNode haiku = null;
        JsonNode glm = null;
        for (var m : models) {
            if (m.path("id").asText().equals("anthropic-claude-haiku-4.5")) haiku = m;
            if (m.path("id").asText().equals("glm-5.3")) glm = m;
        }
        assertThat(haiku.path("effectivePrices").path("batch").isObject()).isTrue();
        assertThat(glm.path("effectivePrices").path("batch").isNull()).isTrue();
        assertThat(glm.path("supportsReasoningEffort").asBoolean()).isTrue();
        assertThat(glm.has("emptyToolCallRate")).isTrue();

        var forecast = call(get("/v1/staff/kb/costs/forecast"), null, 200);
        assertThat(forecast.path("nextRun").path("dirtySubjects").asInt()).isEqualTo(2);
        assertThat(forecast.path("nextRun").path("perStage").path("WRITE").path("mode").asText()).isEqualTo("sync");
        assertThat(forecast.path("weekly").path("basis").asText()).isEqualTo("corpus");
        // Nothing changed in Drive recently, but two subjects are pending: the week includes them.
        assertThat(forecast.path("weekly").path("includesBacklog").asBoolean()).isTrue();
        assertThat(forecast.path("weekly").path("expectedUsd").decimalValue())
            .isEqualByComparingTo(forecast.path("nextRun").path("totalUsd").decimalValue());
        assertThat(forecast.path("monthly").path("expectedUsd").decimalValue())
            .isGreaterThanOrEqualTo(forecast.path("nextRun").path("totalUsd").decimalValue());
        assertThat(forecast.path("monthly").has("expectedUsd")).isTrue();
        assertThat(forecast.path("settingsHash").asText()).isNotBlank();

        var proposed = call(post("/v1/staff/kb/costs/forecast"), "{\"modelWrite\": \"anthropic-claude-haiku-4.5\"}", 200);
        assertThat(proposed.path("nextRun").path("perStage").path("WRITE").path("mode").asText()).isEqualTo("batch");
        assertThat(proposed.path("discountIsEstimate").asBoolean()).isTrue();

        var stage = call(get("/v1/staff/kb/models/anthropic-claude-haiku-4.5/stage-cost?stage=WRITE"), null, 200);
        assertThat(stage.path("stage").asText()).isEqualTo("write");
        assertThat(stage.path("mode").asText()).isEqualTo("batch");
        assertThat(stage.has("expectedWeeklyUsd") && stage.has("low") && stage.has("high") && stage.has("basis")).isTrue();
    }

    @Test
    void evalUsesFrozenInputsNeverPublishesAndFeedsTheLeaderboard() throws Exception {
        probed("anthropic-claude-haiku-4.5", "glm-5.3", "glm-5.3-flash");
        var set = call(post("/v1/staff/kb/evals/sets"),
            "{\"name\": \"Prueba\", \"subjectIds\": [\"" + FIN + "\", \"" + CONT + "\"]}", 201);
        assertThat(set.path("frozenAt").isNull()).isFalse();
        var setId = set.path("id").asText();
        // The live text changes after freezing: the eval still reads the frozen copy.
        changeText(f1, text("omega"));

        var models = "[{\"plan\": \"glm-5.3\", \"write\": \"glm-5.3\", \"reasoningEffort\": {\"plan\": \"low\", "
            + "\"write\": \"medium\"}}, {\"plan\": \"anthropic-claude-haiku-4.5\", \"write\": \"anthropic-claude-haiku-4.5\"}]";
        var estimate = call(post("/v1/staff/kb/evals/estimate"), "{\"setId\": \"" + setId + "\", \"models\": " + models + "}", 200);
        assertThat(estimate.path("estimatedCostUsd").decimalValue()).isPositive();

        var eval = call(post("/v1/staff/kb/evals"), "{\"setId\": \"" + setId + "\", \"models\": " + models + "}", 202);
        var evalId = eval.path("id").asText();
        var early = call(get("/v1/staff/kb/evals/" + evalId + "/progress"), null, 200);
        assertThat(early.path("stages")).hasSize(7);
        call(post("/v1/staff/kb/evals"), "{\"setId\": \"" + setId + "\", \"models\": " + models + "}", 409);
        for (int i = 0; i < 5; i++) engine.advanceActive();

        var done = call(get("/v1/staff/kb/evals/" + evalId), null, 200);
        assertThat(done.path("status").asText()).as(done.toString()).isEqualTo("SUCCEEDED");
        assertThat(done.path("configs")).hasSize(2);
        var keys = new HashSet<String>();
        for (var c : done.path("configs")) {
            keys.add(c.path("configKey").asText());
            assertThat(c.path("metrics").path("validPages").asInt()).as(c.toString()).isEqualTo(2);
            assertThat(c.path("metrics").has("emptyToolCallRate")).isTrue();
            assertThat(c.path("metrics").has("unsupportedClaimsRate")).isTrue();
            assertThat(c.path("perSubject")).hasSize(2);
        }
        for (var c : done.path("configs")) {
            assertThat(c.path("progress").path("percent").asDouble()).isEqualTo(100.0);
            for (var s : c.path("perSubject")) {
                assertThat(s.path("status").asText()).isEqualTo("done");
                assertThat(s.path("pagesPlanned").asInt()).isEqualTo(1);
                assertThat(s.path("pagesWritten").asInt()).isEqualTo(1);
                assertThat(s.path("pagesValid").asInt()).isEqualTo(1);
            }
        }
        assertThat(done.path("progress").path("overall").path("percent").asDouble()).isEqualTo(100.0);
        assertThat(done.path("progress").path("current").asText()).isEqualTo("Terminado");
        assertThat(done.path("reviewSummary").path("totalPairs").asInt()).isEqualTo(2);
        assertThat(done.path("reviewSummary").path("confident").asBoolean()).isFalse();
        assertThat(keys).containsExactlyInAnyOrder("glm-5.3@low|glm-5.3@medium",
            "anthropic-claude-haiku-4.5|anthropic-claude-haiku-4.5");
        // Never published; pages stored under kb/evals/<evalId>/.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM wiki.kb_page", Integer.class)).isZero();
        assertThat(storage.keys()).anyMatch(k -> k.startsWith("kb/evals/" + evalId + "/") && k.endsWith(".md"));
        // Frozen text, not the live one.
        var sent = new StringBuilder();
        llmRequests().forEach(r -> sent.append(r.userText()));
        assertThat(sent.toString()).contains("alfapalabra1 ").doesNotContain("omegapalabra1 ");
        assertThat(jdbc.queryForList("SELECT DISTINCT stage FROM wiki.kb_llm_usage", String.class)).containsOnly("EVAL");
        assertThat(jdbc.queryForList("SELECT DISTINCT mode FROM wiki.kb_batch_job WHERE run_id = ?::uuid", String.class,
            evalId)).contains("SYNC", "BATCH");

        // Blind review: two pages (one per subject) written by both configs.
        int reviews = 0;
        while (true) {
            var res = mvc.perform(get("/v1/staff/kb/evals/" + evalId + "/review/next").with(staff())).andReturn();
            if (res.getResponse().getStatus() == 204) break;
            var pair = json.readTree(res.getResponse().getContentAsString());
            assertThat(pair.path("totalPairs").asInt()).isEqualTo(2);
            assertThat(pair.path("reviewedByMe").asInt()).isEqualTo(reviews);
            assertThat(pair.path("a").path("markdown").asText()).contains("[[file:");
            var src = pair.path("a").path("sources").get(0);
            assertThat(src.path("kind").asText()).isEqualTo("PDF");
            assertThat(src.has("academicYear") && src.has("academicYearSource") && src.has("author")).isTrue();
            assertThat(pair.toString()).doesNotContain("glm-5.3", "haiku");
            var rated = call(post("/v1/staff/kb/evals/" + evalId + "/review"), "{\"subjectId\": \""
                + pair.path("subjectId").asText() + "\", \"slug\": \"" + pair.path("slug").asText()
                + "\", \"winner\": \"A\", \"scoresA\": {\"accuracy\": 5, \"clarity\": 4, \"usefulness\": 4}, "
                + "\"scoresB\": {\"accuracy\": 3, \"clarity\": 3, \"usefulness\": 2}, \"comment\": \"ok\"}", 200);
            assertThat(rated.path("revealed").path("A").path("configKey").asText()).isIn(keys);
            reviews++;
            assertThat(reviews).isLessThan(5);
        }
        assertThat(reviews).isEqualTo(2);
        var rp = call(get("/v1/staff/kb/evals/" + evalId + "/review/progress"), null, 200);
        assertThat(rp.path("totalPairs").asInt()).isEqualTo(2);
        assertThat(rp.path("reviewedByMe").asInt()).isEqualTo(2);
        assertThat(rp.path("reviewedByAnyone").asInt()).isEqualTo(2);
        assertThat(rp.path("remainingForMe").asInt()).isZero();
        assertThat(rp.path("perSubject")).hasSize(2);
        assertThat(rp.path("perSubject").get(0).path("totalPairs").asInt()).isEqualTo(1);
        assertThat(rp.path("perSubject").get(0).path("subjectName").asText()).isNotBlank();
        assertThat(rp.path("ratingsPerConfig")).hasSize(2);
        for (var c : rp.path("ratingsPerConfig")) {
            assertThat(c.path("ratings").asInt()).isEqualTo(2);
            assertThat(c.has("plan") && c.has("write")).isTrue();
        }
        assertThat(rp.path("minRatingsForConfidence").asInt()).isEqualTo(20);
        assertThat(rp.path("confident").asBoolean()).isFalse();

        var board = call(get("/v1/staff/kb/evals/leaderboard?setId=" + setId), null, 200);
        assertThat(board.path("entries")).hasSize(2);
        int ratings = 0;
        for (var e : board.path("entries")) {
            ratings += e.path("ratings").asInt();
            assertThat(e.path("smallSample").asBoolean()).isTrue();
            assertThat(e.path("costPerValidPage").isNull()).isFalse();
        }
        assertThat(ratings).isEqualTo(4);

        var summary = call(get("/v1/staff/kb/costs/summary"), null, 200);
        var weekly = call(get("/v1/staff/kb/costs?groupBy=week,stage"), null, 200);
        assertThat(weekly.toString()).contains("EVAL");
        // Samples for the report (fake executors, simulated costs).
        var out = Path.of("target", "kb-samples");
        Files.createDirectories(out);
        var pretty = json.copy().enable(SerializationFeature.INDENT_OUTPUT);
        Files.writeString(out.resolve("costs-summary.json"), pretty.writeValueAsString(summary));
        Files.writeString(out.resolve("evals-leaderboard.json"), pretty.writeValueAsString(board));

        var promoted = call(post("/v1/staff/kb/evals/" + evalId + "/promote"),
            "{\"configKey\": \"glm-5.3@low|glm-5.3@medium\"}", 200);
        assertThat(promoted.toString()).contains("medium");
        assertThat(call(get("/v1/staff/kb/evals"), null, 200)).isNotEmpty();
    }
}
