package org.ceitba.api.domain;

import java.io.Serializable;
import java.time.LocalTime;
import java.util.Objects;

// Composite-PK class for CommissionTime. Records would be cleaner, but
// JPA @IdClass requires a no-arg constructor + mutable fields, so this
// is a plain class. Same shape applies to every *Id class in this package.
public class CommissionTimeId implements Serializable {

    private String courseId;
    private DayOfWeek day;
    private LocalTime hourFrom;

    public CommissionTimeId() {}

    public CommissionTimeId(String courseId, DayOfWeek day, LocalTime hourFrom) {
        this.courseId = courseId;
        this.day = day;
        this.hourFrom = hourFrom;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof CommissionTimeId other)) return false;
        return Objects.equals(courseId, other.courseId)
            && day == other.day
            && Objects.equals(hourFrom, other.hourFrom);
    }

    @Override
    public int hashCode() {
        return Objects.hash(courseId, day, hourFrom);
    }
}
