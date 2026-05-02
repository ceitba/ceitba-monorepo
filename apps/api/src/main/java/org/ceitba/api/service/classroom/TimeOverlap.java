package org.ceitba.api.service.classroom;

import java.time.LocalTime;

// Open-interval overlap: [a1, a2) overlaps [b1, b2) iff a1 < b2 AND b1 < a2.
// Touching boundaries (09:00-10:00 and 10:00-11:00) do NOT conflict.
final class TimeOverlap {

    private TimeOverlap() {}

    static boolean overlaps(LocalTime aFrom, LocalTime aTo, LocalTime bFrom, LocalTime bTo) {
        return aFrom.isBefore(bTo) && bFrom.isBefore(aTo);
    }
}
