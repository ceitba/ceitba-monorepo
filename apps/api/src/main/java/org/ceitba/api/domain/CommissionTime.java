package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalTime;

@Entity
@Table(schema = "public", name = "commission_time")
@IdClass(CommissionTimeId.class)
public class CommissionTime {

    @Id
    @Column(name = "course_id", length = 20)
    private String courseId;

    @Id
    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(columnDefinition = "day_of_week")
    private DayOfWeek day;

    @Id
    @Column(name = "hour_from", nullable = false)
    private LocalTime hourFrom;

    @Column(nullable = false, length = 50)
    private String classroom;

    @Column(nullable = false, length = 50)
    private String building;

    @Column(name = "hour_to", nullable = false)
    private LocalTime hourTo;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "course_id", insertable = false, updatable = false)
    private Commission commission;

    protected CommissionTime() {}

    public CommissionTime(String courseId, DayOfWeek day, LocalTime hourFrom,
                          String classroom, String building, LocalTime hourTo) {
        this.courseId = courseId;
        this.day = day;
        this.hourFrom = hourFrom;
        this.classroom = classroom;
        this.building = building;
        this.hourTo = hourTo;
    }

    public String getCourseId() { return courseId; }
    public DayOfWeek getDay() { return day; }
    public LocalTime getHourFrom() { return hourFrom; }
    public String getClassroom() { return classroom; }
    public String getBuilding() { return building; }
    public LocalTime getHourTo() { return hourTo; }
    public Commission getCommission() { return commission; }
}
