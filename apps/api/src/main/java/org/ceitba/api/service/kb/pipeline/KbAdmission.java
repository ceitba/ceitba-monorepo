package org.ceitba.api.service.kb.pipeline;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

// Which dirty subjects a run takes on (docs/SUBJECT-WIKI-PIPELINE.md, "Cost
// budget and admission"). Candidates are sorted smallest estimated cost first
// (ties: oldest dirty first, i.e. never compiled, then oldest compiledAt, then
// id) and admitted while their whole end-to-end estimate fits the remaining
// cost budget (and the secondary token budget). Exception: when even the first
// candidate does not fit, it is admitted alone (a dedicated run), so a huge
// subject is not starved forever.
public final class KbAdmission {

    private KbAdmission() {}

    // dirtySince: when the subject was last compiled (null = never = oldest).
    public record Candidate(String subjectId, BigDecimal costUsd, long inputTokens, OffsetDateTime dirtySince) {}

    // oversized: the subject admitted alone because it exceeds the budget (or null).
    public record Result(List<Candidate> admitted, List<Candidate> deferred, Candidate oversized) {
        public BigDecimal admittedUsd() {
            return sum(admitted);
        }

        public BigDecimal deferredUsd() {
            return sum(deferred);
        }
    }

    public static final Comparator<Candidate> ORDER = Comparator
        .comparing(Candidate::costUsd)
        .thenComparing(Candidate::dirtySince, Comparator.nullsFirst(Comparator.naturalOrder()))
        .thenComparing(Candidate::subjectId);

    public static Result admit(List<Candidate> candidates, BigDecimal budgetUsd, long tokenBudget) {
        var sorted = new ArrayList<>(candidates);
        sorted.sort(ORDER);
        var admitted = new ArrayList<Candidate>();
        var deferred = new ArrayList<Candidate>();
        var usd = BigDecimal.ZERO;
        long tokens = 0;
        Candidate oversized = null;
        for (var c : sorted) {
            if (oversized != null) {
                deferred.add(c);
                continue;
            }
            boolean fits = usd.add(c.costUsd()).compareTo(budgetUsd) <= 0 && tokens + c.inputTokens() <= tokenBudget;
            if (fits) {
                admitted.add(c);
                usd = usd.add(c.costUsd());
                tokens += c.inputTokens();
            } else if (admitted.isEmpty()) {
                oversized = c;
                admitted.add(c);
            } else {
                deferred.add(c);
            }
        }
        return new Result(admitted, deferred, oversized);
    }

    private static BigDecimal sum(List<Candidate> list) {
        var t = BigDecimal.ZERO;
        for (var c : list) t = t.add(c.costUsd());
        return t;
    }
}
