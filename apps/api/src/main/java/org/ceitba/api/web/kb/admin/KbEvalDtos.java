package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// Evaluation endpoints (docs/SUBJECT-WIKI-ADMIN.md §4, §6, §8).
public final class KbEvalDtos {

    private KbEvalDtos() {}

    // frozen: per subject, what the set froze (null until frozen).
    public record EvalSet(UUID id, String name, List<String> subjectIds, UUID createdBy, OffsetDateTime createdAt,
                          OffsetDateTime frozenAt, List<FrozenSubject> frozen) {}

    public record FrozenSubject(String subjectId, String subjectName, int files, long chars, int digestsMissing) {}

    // configKey: "<plan>[@effort]|<write>[@effort]", e.g. glm-5.3@low|glm-5.3@medium.
    public record Config(String configKey, String plan, String write, JsonNode reasoningEffort, String status,
                         JsonNode metrics, List<SubjectResult> perSubject) {}

    public record SubjectResult(String subjectId, String subjectName, JsonNode metrics, List<PageResult> pages) {}

    public record PageResult(String slug, String title, boolean valid, boolean firstPassValid, List<String> errors) {}

    // status: RUNNING | WAITING | SUCCEEDED | FAILED | CANCELLED; stage of the
    // underlying run. sharedDigest: digests computed for the set (not per config).
    public record Eval(UUID id, UUID setId, String setName, String status, String stage, String note,
                       OffsetDateTime createdAt, OffsetDateTime finishedAt, Long durationSec, long tokensIn,
                       long tokensOut, BigDecimal costUsd, boolean simulated, String error, JsonNode sharedDigest,
                       List<Config> configs) {}

    public record Estimate(long estimatedInputTokens, long estimatedOutputTokens, BigDecimal estimatedCostUsd) {}

    // A page as the reviewer sees it (configuration hidden). sources and links
    // have the reader's Page shapes (KbSourceResponse, KbLinkResponse); a link
    // resolves to a page the same configuration wrote, or to a live page.
    public record ReviewPage(String title, String markdown, List<org.ceitba.api.web.kb.dto.KbSourceResponse> sources,
                             List<org.ceitba.api.web.kb.dto.KbLinkResponse> links) {}

    // remaining: page pairs this reviewer has not rated yet (this one included).
    public record ReviewPair(String subjectId, String slug, int remaining, ReviewPage a, ReviewPage b) {}

    public record Revealed(ConfigRef A, ConfigRef B) {}

    public record ConfigRef(String configKey, String plan, String write) {}

    public record ReviewResult(Revealed revealed) {}

    public record Scores(Double accuracy, Double clarity, Double usefulness) {}

    // winRate: (wins + ties/2) / rated pairs; smallSample: fewer than 20 ratings.
    public record LeaderboardEntry(String configKey, String plan, String write, JsonNode reasoningEffort, int evals,
                                   int ratings, int wins, int losses, int ties, Double winRate, Scores avgScores,
                                   JsonNode metrics, BigDecimal costUsd, BigDecimal costPerValidPage,
                                   boolean smallSample) {}

    public record Leaderboard(UUID setId, String setName, List<LeaderboardEntry> entries) {}
}
