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
        assertThat(updated.path("costImpact").has("projectedWeeklyAvgUsd")).isTrue();
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
        assertThat(history).hasSize(2);
        var oldest = history.get(history.size() - 1).path("id").asText();
        call(post("/v1/staff/kb/settings/history/" + oldest + "/restore"), null, 200);
        assertThat(call(get("/v1/staff/kb/settings"), null, 200).path("settings").path("modelPlan").asText())
            .isEqualTo("anthropic-claude-haiku-4.5");
        assertThat(call(get("/v1/staff/kb/settings/history"), null, 200)).hasSize(3);
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
        assertThat(forecast.path("monthly").has("expectedUsd")).isTrue();
        assertThat(forecast.path("settingsHash").asText()).isNotBlank();

        var proposed = call(post("/v1/staff/kb/costs/forecast"), "{\"modelWrite\": \"anthropic-claude-haiku-4.5\"}", 200);
        assertThat(proposed.path("nextRun").path("perStage").path("WRITE").path("mode").asText()).isEqualTo("batch");
        assertThat(proposed.path("discountIsEstimate").asBoolean()).isTrue();

        var stage = call(get("/v1/staff/kb/models/anthropic-claude-haiku-4.5/stage-cost?stage=write"), null, 200);
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
            assertThat(pair.path("a").path("markdown").asText()).contains("[[file:");
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
