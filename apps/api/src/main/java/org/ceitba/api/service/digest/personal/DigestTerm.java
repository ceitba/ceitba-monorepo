package org.ceitba.api.service.digest.personal;

import org.ceitba.api.domain.Commission;
import org.ceitba.api.service.commission.CommissionTerms;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

// Is a user's primary saved schedule about the current term, and which
// commissions does it pick? (docs/WEEKLY-DIGEST.md, "Tu cuatrimestre".)
//
// A commission row has no year/period, only course dates, and a saved
// schedule stores subject codes + commission NAMES ("A", "any"), not ids.
// Since most subjects keep the same commission names every term, a name alone
// can't tell this term's schedule from last term's. So:
//
//   1. The current term of a subject = its commissions that have not ended
//      (course_end >= today) and start within LOOKAHEAD_DAYS (course_start <=
//      today + 14), narrowed to the newest term with CommissionTerms (the
//      same rule GET /v1/subjects uses). Unlike the scheduler, a term synced
//      months ahead is NOT current: the digest is about what you attend now
//      (and, the two weeks before classes start, what you are about to).
//   2. A schedule entry picks, of that, the commissions whose name it lists
//      (none listed or "any" = every commission of the subject). An entry
//      whose names aren't offered this term, or a subject with no current
//      commission, is dropped.
//   3. The schedule is current when at least one entry survives AND it was
//      saved (payload_updated_at, ART) no earlier than PLANNING_LEAD_DAYS before the
//      latest course_start among the picked commissions. Students build next
//      term's schedule in the weeks before it starts; consecutive terms start
//      ~4-5 months apart, so a schedule saved for the previous term is older
//      than that and is stale.
//
// The user's own commission of a subject (used for correction prompts) is
// only known when the entry names exactly one commission.
public final class DigestTerm {

    static final int LOOKAHEAD_DAYS = 14;
    static final int PLANNING_LEAD_DAYS = 60;
    static final String ANY = "any";

    private DigestTerm() {}

    // One `selectedCourses[]` entry of a saved schedule payload.
    public record Pick(String subjectCode, List<String> commissionNames) {}

    // A subject of the current term on the user's schedule. `commissionName`
    // is set (and `commissions` are the user's) only when the schedule names
    // exactly one commission; else `commissions` are every candidate.
    public record CurrentSubject(String subjectCode, String commissionName, List<Commission> commissions) {}

    public record Resolution(boolean current, List<CurrentSubject> subjects) {
        static final Resolution STALE = new Resolution(false, List.of());
    }

    // The scheduler's payload v1 (scheduler/src/services/workspaceSnapshot.ts;
    // the app writes the same shape): {selectedCourses: [{subject_id,
    // selectedCommissions: [names]}]}. Anything malformed is skipped.
    public static List<Pick> parsePayload(Map<String, Object> payload) {
        if (payload == null || !(payload.get("selectedCourses") instanceof List<?> courses)) return List.of();
        var out = new ArrayList<Pick>();
        for (Object o : courses) {
            if (!(o instanceof Map<?, ?> m) || !(m.get("subject_id") instanceof String code) || code.isBlank()) continue;
            var names = new ArrayList<String>();
            if (m.get("selectedCommissions") instanceof List<?> list) {
                for (Object n : list) if (n instanceof String s) names.add(s);
            }
            out.add(new Pick(code.trim(), names));
        }
        return out;
    }

    // Commissions of ONE subject (any terms) -> those of its current term.
    public static List<Commission> currentTermOf(List<Commission> subjectCommissions, LocalDate today) {
        LocalDate startsBy = today.plusDays(LOOKAHEAD_DAYS);
        var candidates = subjectCommissions.stream()
            .filter(c -> !c.getCourseEnd().isBefore(today) && !c.getCourseStart().isAfter(startsBy))
            .toList();
        return CommissionTerms.currentTerm(candidates, today);
    }

    // Commissions of many subjects -> per subject code its current term
    // (subjects without one are left out).
    public static Map<String, List<Commission>> currentTermBySubject(Collection<Commission> commissions,
                                                                     LocalDate today) {
        var bySubject = new LinkedHashMap<String, List<Commission>>();
        for (var c : commissions) bySubject.computeIfAbsent(c.getSubjectCode(), k -> new ArrayList<>()).add(c);
        var out = new LinkedHashMap<String, List<Commission>>();
        bySubject.forEach((code, list) -> {
            var term = currentTermOf(list, today);
            if (!term.isEmpty()) out.put(code, term);
        });
        return out;
    }

    public static Resolution resolve(List<Pick> picks, LocalDate savedOn,
                                     Map<String, List<Commission>> currentBySubject) {
        var subjects = new ArrayList<CurrentSubject>();
        var seen = new LinkedHashSet<String>();
        for (var pick : picks) {
            if (!seen.add(pick.subjectCode())) continue;
            var term = currentBySubject.getOrDefault(pick.subjectCode(), List.of());
            if (term.isEmpty()) continue;
            var names = pick.commissionNames().stream()
                .map(String::trim)
                .filter(n -> !n.isEmpty() && !n.equalsIgnoreCase(ANY))
                .distinct()
                .toList();
            if (names.isEmpty()) {
                subjects.add(new CurrentSubject(pick.subjectCode(), null, term));
                continue;
            }
            var matched = term.stream().filter(c -> names.contains(c.getCommissionName())).toList();
            if (matched.isEmpty()) continue;
            subjects.add(new CurrentSubject(pick.subjectCode(), names.size() == 1 ? names.get(0) : null, matched));
        }
        if (subjects.isEmpty() || savedOn == null) return Resolution.STALE;
        LocalDate latestStart = subjects.stream()
            .flatMap(s -> s.commissions().stream())
            .map(Commission::getCourseStart)
            .max(Comparator.naturalOrder())
            .orElseThrow();
        if (savedOn.isBefore(latestStart.minusDays(PLANNING_LEAD_DAYS))) return Resolution.STALE;
        return new Resolution(true, List.copyOf(subjects));
    }
}
