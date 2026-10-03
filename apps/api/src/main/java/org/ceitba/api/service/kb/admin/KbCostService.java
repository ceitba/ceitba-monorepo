package org.ceitba.api.service.kb.admin;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.ClockConfig;
import org.ceitba.api.domain.kb.KbLlmUsage;
import org.ceitba.api.domain.kb.KbModel;
import org.ceitba.api.domain.kb.KbRun;
import org.ceitba.api.repository.SubjectRepository;
import org.ceitba.api.repository.kb.KbLlmUsageRepository;
import org.ceitba.api.repository.kb.KbModelRepository;
import org.ceitba.api.repository.kb.KbRunRepository;
import org.ceitba.api.service.kb.llm.KbLlmRouter;
import org.ceitba.api.service.kb.llm.KbPricing;
import org.ceitba.api.web.kb.admin.KbCostRowResponse;
import org.ceitba.api.web.kb.admin.KbCostSummaryResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

// Cost analytics over kb_llm_usage (docs/SUBJECT-WIKI-ADMIN.md §3). Stored
// costs are frozen at the price of their run; reprice=true recomputes them
// with today's catalog prices on read.
@Service
public class KbCostService {

    private final KbLlmUsageRepository usage;
    private final KbModelRepository models;
    private final KbRunRepository runs;
    private final SubjectRepository subjects;
    private final KbLlmRouter router;
    private final Clock clock;

    public KbCostService(KbLlmUsageRepository usage, KbModelRepository models, KbRunRepository runs,
                         SubjectRepository subjects, KbLlmRouter router, Clock clock) {
        this.usage = usage;
        this.models = models;
        this.runs = runs;
        this.subjects = subjects;
        this.router = router;
        this.clock = clock;
    }

    static final List<String> DIMENSIONS = List.of("week", "stage", "model", "subject");

    // groupBy: one or more of week, stage, model, subject (comma separated).
    @Transactional(readOnly = true)
    public List<KbCostRowResponse> costs(OffsetDateTime from, OffsetDateTime to, String groupBy, boolean reprice) {
        var now = OffsetDateTime.now(clock);
        var f = from == null ? now.minusDays(30) : from;
        var t = to == null ? now : to;
        var dims = list(groupBy == null || groupBy.isBlank() ? "week" : groupBy.toLowerCase(Locale.ROOT));
        for (var d : dims) {
            if (!DIMENSIONS.contains(d)) {
                throw new ValidationException("groupBy", groupBy, "must be one or more of " + DIMENSIONS);
            }
        }
        Map<String, KbModel> catalog = catalog();
        Map<List<String>, long[]> tokens = new LinkedHashMap<>();
        Map<List<String>, BigDecimal> cost = new HashMap<>();
        for (var u : usage.findByCreatedAtBetween(f, t)) {
            var key = new ArrayList<String>();
            key.add(dims.contains("week") ? week(u) : null);
            key.add(dims.contains("stage") ? u.getStage() : null);
            key.add(dims.contains("model") ? u.getModel() : null);
            key.add(dims.contains("subject") ? (u.getSubjectId() == null ? "-" : u.getSubjectId()) : null);
            var acc = tokens.computeIfAbsent(key, x -> new long[4]);
            acc[0] += u.getInputTokens();
            acc[1] += u.getCachedInputTokens();
            acc[2] += u.getOutputTokens();
            acc[3]++;
            var c = reprice ? KbPricing.cost(catalog.get(u.getModel()), u.getMode(), u.getInputTokens(),
                u.getCachedInputTokens(), u.getOutputTokens()) : u.getCostUsd();
            cost.merge(key, c, BigDecimal::add);
        }
        Comparator<KbCostRowResponse> order = Comparator.comparing(KbCostRowResponse::week, Comparator.nullsFirst(Comparator.naturalOrder()))
            .thenComparing(KbCostRowResponse::stage, Comparator.nullsFirst(Comparator.naturalOrder()))
            .thenComparing(KbCostRowResponse::model, Comparator.nullsFirst(Comparator.naturalOrder()))
            .thenComparing(KbCostRowResponse::subjectId, Comparator.nullsFirst(Comparator.naturalOrder()));
        return tokens.entrySet().stream()
            .map(e -> new KbCostRowResponse(e.getKey().get(0), e.getKey().get(1), e.getKey().get(2), e.getKey().get(3),
                e.getValue()[0], e.getValue()[1], e.getValue()[2], usd(cost.get(e.getKey())), e.getValue()[3]))
            .sorted(order)
            .toList();
    }

    @Transactional(readOnly = true)
    public KbCostSummaryResponse summary() {
        var now = OffsetDateTime.now(clock);
        var last30 = usage.findByCreatedAtBetween(now.minusDays(30), now);
        var last7 = BigDecimal.ZERO;
        var total30 = BigDecimal.ZERO;
        var last28 = BigDecimal.ZERO;
        long input = 0;
        long cached = 0;
        boolean simulated = false;
        Map<String, BigDecimal> byStage = new java.util.TreeMap<>();
        Map<String, BigDecimal> byModel = new java.util.TreeMap<>();
        Map<String, BigDecimal> bySubject = new HashMap<>();
        for (var u : last30) {
            var c = u.getCostUsd();
            total30 = total30.add(c);
            if (u.getCreatedAtOrNull() != null && u.getCreatedAtOrNull().isAfter(now.minusDays(7))) last7 = last7.add(c);
            if (u.getCreatedAtOrNull() != null && u.getCreatedAtOrNull().isAfter(now.minusDays(28))) last28 = last28.add(c);
            input += u.getInputTokens();
            cached += u.getCachedInputTokens();
            simulated |= u.isSimulated();
            byStage.merge(u.getStage(), c, BigDecimal::add);
            byModel.merge(u.getModel(), c, BigDecimal::add);
            if (u.getSubjectId() != null) bySubject.merge(u.getSubjectId(), c, BigDecimal::add);
        }
        // Average week of the last 4 weeks x 4.345 weeks per month.
        var projected = last28.divide(BigDecimal.valueOf(4), 6, RoundingMode.HALF_UP).multiply(new BigDecimal("4.345"));
        var names = new HashMap<String, String>();
        subjects.findAllById(bySubject.keySet()).forEach(s -> names.put(s.getId(), s.getName()));
        var top = bySubject.entrySet().stream()
            .sorted(Map.Entry.<String, BigDecimal>comparingByValue().reversed())
            .limit(5)
            .map(e -> new KbCostSummaryResponse.SubjectCost(e.getKey(), names.get(e.getKey()), usd(e.getValue())))
            .toList();
        byStage.replaceAll((k, v) -> usd(v));
        byModel.replaceAll((k, v) -> usd(v));
        double ratio = input == 0 ? 0 : (double) cached / input;
        var accuracy = runs.findByTriggerNotOrderByStartedAtDesc("EVAL", PageRequest.of(0, 30)).stream()
            .filter(r -> r.getStatus().equals("SUCCEEDED") && r.getExpectedCostUsd() != null)
            .limit(8)
            .map(r -> new KbCostSummaryResponse.RunAccuracy(r.getId(), usd(r.getExpectedCostUsd()), usd(r.getCostEstimate())))
            .toList();
        return new KbCostSummaryResponse(usd(last7), usd(total30), usd(projected), byStage, byModel, top,
            Math.round(ratio * 10000) / 10000.0, simulated, new KbCostSummaryResponse.Accuracy(accuracy));
    }

    // Rough cost of requests before submitting them: estimated input tokens
    // plus half of max_tokens as output.
    public BigDecimal estimate(String model, String mode, long inputTokens, long maxOutputTokens) {
        return KbPricing.cost(models.findById(model).orElse(null), mode, inputTokens, 0, maxOutputTokens / 2);
    }

    private Map<String, KbModel> catalog() {
        Map<String, KbModel> out = new HashMap<>();
        models.findAll().forEach(m -> out.put(m.getId(), m));
        return out;
    }

    // ISO date of the Monday of the usage's week, Buenos Aires time.
    private static String week(KbLlmUsage u) {
        var d = u.getCreatedAtOrNull().atZoneSameInstant(ClockConfig.ZONE).toLocalDate();
        return d.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)).toString();
    }

    static BigDecimal usd(BigDecimal v) {
        return (v == null ? BigDecimal.ZERO : v).setScale(4, RoundingMode.HALF_UP);
    }

    static List<String> list(String csv) {
        var out = new ArrayList<String>();
        if (csv == null) return out;
        for (var s : csv.split(",")) if (!s.isBlank()) out.add(s.trim());
        return out;
    }
}
