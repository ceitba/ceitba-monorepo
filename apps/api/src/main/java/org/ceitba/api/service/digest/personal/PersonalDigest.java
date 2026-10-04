package org.ceitba.api.service.digest.personal;

import org.ceitba.api.domain.correction.CorrectionSlot;

import java.util.List;
import java.util.UUID;

// What "Tu cuatrimestre" shows one reader (docs/WEEKLY-DIGEST.md). Readers
// with nothing to show have no PersonalDigest at all.
public record PersonalDigest(State state, List<SubjectLine> subjects, List<WikiLink> wiki,
                             List<CorrectionPrompt> corrections) {

    public enum State {
        // A primary schedule of the current term: subjects, wiki, corrections.
        CURRENT,
        // A term is running but the reader has no current primary schedule:
        // only the "Armá tu horario" call to action.
        NEEDS_SCHEDULE
    }

    public static PersonalDigest needsSchedule() {
        return new PersonalDigest(State.NEEDS_SCHEDULE, List.of(), List.of(), List.of());
    }

    // commissionName is null when the schedule doesn't name exactly one.
    public record SubjectLine(String code, String name, String commissionName) {}

    public record WikiLink(String subjectCode, String subjectName, String url, boolean updatedThisWeek) {}

    // Never carries the suggester (or any voter).
    public record CorrectionPrompt(UUID correctionId, String subjectName, String commissionName,
                                   List<CorrectionSlot> proposed, List<CorrectionSlot> sga) {}
}
