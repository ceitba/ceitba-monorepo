package org.ceitba.api.web.kb.admin;

import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.ClockConfig;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;

// from/to query parameters of the staff kb endpoints (ADMIN doc, "Date
// parameters"): a full ISO offset datetime, or a date-only YYYY-MM-DD in
// America/Argentina/Buenos_Aires where `from` is the start of that day and
// `to` the end of it (inclusive). Anything else is a 400 ValidationError.
public final class KbDateParam {

    private KbDateParam() {}

    public static OffsetDateTime from(String value) {
        return parse("from", value, false);
    }

    public static OffsetDateTime to(String value) {
        return parse("to", value, true);
    }

    static OffsetDateTime parse(String field, String value, boolean endOfDay) {
        if (value == null || value.isBlank()) return null;
        var v = value.trim();
        try {
            if (v.length() == 10) {
                var day = LocalDate.parse(v);
                var start = day.atStartOfDay(ClockConfig.ZONE);
                return (endOfDay ? start.plusDays(1).minusNanos(1) : start).toOffsetDateTime();
            }
            return OffsetDateTime.parse(v);
        } catch (DateTimeParseException e) {
            throw new ValidationException(field, value,
                "must be a date (YYYY-MM-DD) or an ISO datetime with offset (2026-07-11T00:00:00-03:00)");
        }
    }
}
