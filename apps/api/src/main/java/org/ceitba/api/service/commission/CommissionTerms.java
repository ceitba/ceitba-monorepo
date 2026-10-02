package org.ceitba.api.service.commission;

import org.ceitba.api.domain.Commission;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

// Picks which synced commissions of a subject are "the term to show". Shared
// by GET /v1/subjects (SubjectPlanService) and GET /v1/commissions
// (CommissionService) so both endpoints always agree.
//
// The commission table accumulates every term the sync job has ever seen
// (rows are upserted by ITBA id and never pruned), and a commission row
// carries no year/period: ITBA's courseCommissions payload has no such field
// and the (year, period) the sync queried with is not stored. The only term
// signal is the course dates, so a term is identified by course_start:
//
//   1. Candidates are the commissions that have not ended (course_end >=
//      today). If there are none — between terms, before the next term is
//      synced — every commission is a candidate (fallback), so the subject
//      shows its most recent term instead of going empty.
//   2. Of the candidates, keep the NEWEST term: the commissions whose
//      course_start is within TERM_WINDOW_DAYS of the latest course_start.
//      When the next term is synced before the current one ends, both are
//      "not ended" and only the upcoming one is shown (students plan it).
//
// The window keeps offerings that genuinely run in the same term with
// different dates, e.g. 81.74's two bimester modules (A 14/09–23/10 and
// A 26/10–30/11, starts 42 days apart). Consecutive terms start much further
// apart: first semester (March) → second (late July/August) is ~5 months,
// a late second-semester module (late October) → next March ~4 months,
// summer course (January) → March ~2 months. 60 days sits between the
// widest observed same-term spread and the narrowest gap between terms.
public final class CommissionTerms {

    static final int TERM_WINDOW_DAYS = 60;

    private CommissionTerms() {}

    // One subject's commissions → the ones of the term to show, preserving
    // the input order.
    public static List<Commission> currentTerm(List<Commission> commissions, LocalDate today) {
        if (commissions.isEmpty()) {
            return commissions;
        }
        var notEnded = commissions.stream()
            .filter(c -> !c.getCourseEnd().isBefore(today))
            .toList();
        return newestTerm(notEnded.isEmpty() ? commissions : notEnded);
    }

    // Commissions of any number of subjects → per subject code (in order of
    // first appearance) the commissions of its term to show.
    public static Map<String, List<Commission>> currentTermBySubject(Collection<Commission> commissions,
                                                                     LocalDate today) {
        var bySubject = new LinkedHashMap<String, List<Commission>>();
        for (var c : commissions) {
            bySubject.computeIfAbsent(c.getSubjectCode(), k -> new ArrayList<>()).add(c);
        }
        bySubject.replaceAll((code, list) -> currentTerm(list, today));
        return bySubject;
    }

    private static List<Commission> newestTerm(List<Commission> candidates) {
        LocalDate newestStart = candidates.stream()
            .map(Commission::getCourseStart)
            .max(Comparator.naturalOrder())
            .orElseThrow();
        LocalDate termFrom = newestStart.minusDays(TERM_WINDOW_DAYS);
        return candidates.stream()
            .filter(c -> !c.getCourseStart().isBefore(termFrom))
            .toList();
    }
}
