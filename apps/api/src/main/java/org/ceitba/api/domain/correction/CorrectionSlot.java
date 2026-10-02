package org.ceitba.api.domain.correction;

import org.ceitba.api.domain.DayOfWeek;

import java.time.LocalTime;
import java.util.Comparator;

// One normalized weekly slot of a schedule correction, as stored in the
// schedule_correction JSONB columns: {"day": "TUESDAY", "from": "08:00", "to": "11:00"}.
// Times are "HH:mm" ART wall-clock strings (not LocalTime) so the JSON stays
// readable and independent of Jackson's java.time settings.
public record CorrectionSlot(String day, String from, String to) {

    public static final Comparator<CorrectionSlot> ORDER = Comparator
        .comparing((CorrectionSlot s) -> DayOfWeek.valueOf(s.day()).ordinal())
        .thenComparing(CorrectionSlot::from)
        .thenComparing(CorrectionSlot::to);

    public DayOfWeek dayOfWeek() { return DayOfWeek.valueOf(day); }
    public LocalTime fromTime()  { return LocalTime.parse(from); }
    public LocalTime toTime()    { return LocalTime.parse(to); }

    // Canonical text form, e.g. "TUESDAY 08:00-11:00".
    public String key() { return day + " " + from + "-" + to; }
}
