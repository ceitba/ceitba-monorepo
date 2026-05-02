package org.ceitba.api.domain;

// Distinct from java.time.DayOfWeek so the JPA mapping to the PG enum
// public.day_of_week is unambiguous (and so we own the enum names).
public enum DayOfWeek {
    MONDAY,
    TUESDAY,
    WEDNESDAY,
    THURSDAY,
    FRIDAY,
    SATURDAY,
    SUNDAY
}
