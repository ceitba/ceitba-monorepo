package org.ceitba.api.service.digest;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.TextStyle;
import java.util.Locale;

// The covered week of an issue (Monday..Sunday) and the following week, whose
// events the issue announces.
public record DigestWeek(LocalDate weekStart) {

    static final Locale ES = Locale.forLanguageTag("es-AR");

    public DigestWeek {
        if (weekStart == null || weekStart.getDayOfWeek() != DayOfWeek.MONDAY) {
            throw new DigestException(DigestException.Reason.INVALID_WEEK_START,
                "weekStart must be a Monday (YYYY-MM-DD), got " + weekStart);
        }
    }

    public static boolean isMonday(LocalDate d) {
        return d != null && d.getDayOfWeek() == DayOfWeek.MONDAY;
    }

    // The Monday of the week before the one `today` falls in.
    public static DigestWeek previousWeek(LocalDate today) {
        LocalDate monday = today.minusDays(today.getDayOfWeek().getValue() - 1L);
        return new DigestWeek(monday.minusWeeks(1));
    }

    public LocalDate weekEnd()     { return weekStart.plusDays(6); }
    public LocalDate eventsFrom()  { return weekStart.plusDays(7); }
    public LocalDate eventsTo()    { return weekStart.plusDays(13); }

    // "5 al 11 de octubre", "29 de septiembre al 5 de octubre".
    public String rangeLabel() {
        return range(weekStart, weekEnd());
    }

    public String defaultSubject() {
        return "La semana en ITBA · " + rangeLabel();
    }

    static String range(LocalDate from, LocalDate to) {
        if (from.getMonth() == to.getMonth()) {
            return from.getDayOfMonth() + " al " + to.getDayOfMonth() + " de " + month(to);
        }
        return from.getDayOfMonth() + " de " + month(from) + " al " + to.getDayOfMonth() + " de " + month(to);
    }

    static String month(LocalDate d) {
        return d.getMonth().getDisplayName(TextStyle.FULL, ES).toLowerCase(ES);
    }

    // "lunes 13 de octubre"
    static String longDate(LocalDate d) {
        return d.getDayOfWeek().getDisplayName(TextStyle.FULL, ES).toLowerCase(ES)
            + " " + d.getDayOfMonth() + " de " + month(d);
    }
}
