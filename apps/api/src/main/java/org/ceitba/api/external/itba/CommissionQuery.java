package org.ceitba.api.external.itba;

import java.time.LocalDate;
import java.util.List;

// Optional commission filters; missing fields fall back to "current period"
// (Feb-June = FirstSemester, else SecondSemester). Default levels include
// both GRADUATE and UNDERGRADUATE.
public record CommissionQuery(Integer year, String period, List<String> levels) {

    public static final List<String> DEFAULT_LEVELS = List.of("GRADUATE", "UNDERGRADUATE");

    public static CommissionQuery defaults() {
        return new CommissionQuery(null, null, null);
    }

    public CommissionQuery withDefaultsFilled() {
        var today = LocalDate.now();
        var defaultPeriod = today.getMonthValue() >= 2 && today.getMonthValue() <= 6
            ? "FirstSemester"
            : "SecondSemester";
        return new CommissionQuery(
            year != null ? year : today.getYear(),
            period != null ? period : defaultPeriod,
            levels != null && !levels.isEmpty() ? levels : DEFAULT_LEVELS
        );
    }
}
