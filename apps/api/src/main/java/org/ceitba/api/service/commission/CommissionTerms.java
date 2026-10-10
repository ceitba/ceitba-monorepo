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
// (rows are upserted by ITBA id and never pruned). Since V54 a row records
// the (year, period) of the last sync query that listed it (term_year /
// term_period), but rows inserted outside the sync have none and ITBA's
// payload itself carries no term, so this still selects by the course dates,
// identifying a term by course_start:
//
//   1. Candidates are the commissions that have not ended (course_end >=
//      today). If there are none — between terms, before the next term is
//      synced — every commission is a candidate (fallback), so the subject
//      shows its most recent term instead of going empty.
//   2. Of the candidates, keep the NEWEST term. Let N be the latest
//      course_start among them; a candidate belongs to the newest term when
//        (a) its course_start is within TERM_WINDOW_DAYS of N (inclusive), or
//        (b) its course_end >= N, i.e. it is still running when the newest
//            term begins.
//      Everything else ended before the newest term started and is an older
//      term. When the next term is synced before the current one ends, both
//      are "not ended" and only the upcoming one is shown (students plan it).
//
// (a) keeps offerings of the same term with different dates, e.g. 81.74's two
// bimester modules (A 14/09–23/10 and A 26/10–30/11, starts 42 days apart).
// (b) keeps long offerings that overlap the newest term although they started
// much earlier, e.g. 72.45's year-long commission (01/03–31/12) next to its
// second-semester ones (26/07–31/12, 147 days later), or a commission
// running 26/07/2026–27/06/2027 once the March 2027 term is synced.
// Consecutive terms do not overlap — first semester ends ~25/07 and the
// second starts ~26/07; the second ends in December and the next March term
// starts months later — so (b) never pulls an older term in, and their starts
// are much further apart than the window: first semester (March) → second
// (late July/August) is ~5 months, a late second-semester module (late
// October) → next March ~4 months, summer course (January) → March ~2
// months. 60 days sits between the widest observed same-term spread and the
// narrowest gap between terms.
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

    // Whether currentTerm fell back to an ended term for these (already
    // selected) commissions: none of them is still running.
    public static boolean isPastTerm(List<Commission> selected, LocalDate today) {
        return !selected.isEmpty() && selected.stream().allMatch(c -> c.getCourseEnd().isBefore(today));
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
            .filter(c -> !c.getCourseStart().isBefore(termFrom)        // (a) starts within the window
                || !c.getCourseEnd().isBefore(newestStart))            // (b) still running at newestStart
            .toList();
    }
}
