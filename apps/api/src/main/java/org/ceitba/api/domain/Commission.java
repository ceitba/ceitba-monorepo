package org.ceitba.api.domain;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(schema = "public", name = "commission")
public class Commission {

    @Id
    @Column(length = 20)
    private String id;

    @Column(name = "subject_code", nullable = false, length = 10)
    private String subjectCode;

    @Column(name = "commission_name", nullable = false, length = 50)
    private String commissionName;

    @Column(name = "course_start", nullable = false)
    private LocalDate courseStart;

    @Column(name = "course_end", nullable = false)
    private LocalDate courseEnd;

    @Column(name = "enrolled_students", nullable = false)
    private int enrolledStudents;

    @Column(nullable = false)
    private int quota;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "subject_type", nullable = false, columnDefinition = "subject_type")
    private SubjectType subjectType = SubjectType.SEMESTRAL;

    // The (year, period) of the last sync query that returned this commission,
    // e.g. 2026 / "SecondSemester". Null only for a row inserted outside the
    // sync (tests, dev seeds); V54 backfilled older rows from course_start.
    @Column(name = "term_year")
    private Short termYear;

    @Column(name = "term_period", length = 20)
    private String termPeriod;

    @OneToMany(mappedBy = "commission", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("day ASC, hourFrom ASC")
    private List<CommissionTime> times = new ArrayList<>();

    protected Commission() {}

    public Commission(String id, String subjectCode, String commissionName,
                      LocalDate courseStart, LocalDate courseEnd,
                      int enrolledStudents, int quota, SubjectType subjectType) {
        this.id = id;
        this.subjectCode = subjectCode;
        this.commissionName = commissionName;
        this.courseStart = courseStart;
        this.courseEnd = courseEnd;
        this.enrolledStudents = enrolledStudents;
        this.quota = quota;
        this.subjectType = subjectType;
    }

    public String getId() { return id; }
    public String getSubjectCode() { return subjectCode; }
    public String getCommissionName() { return commissionName; }
    public LocalDate getCourseStart() { return courseStart; }
    public LocalDate getCourseEnd() { return courseEnd; }
    public int getEnrolledStudents() { return enrolledStudents; }
    public int getQuota() { return quota; }
    public SubjectType getSubjectType() { return subjectType; }
    public Short getTermYear() { return termYear; }
    public String getTermPeriod() { return termPeriod; }
    public List<CommissionTime> getTimes() { return times; }

    public void setEnrolledStudents(int enrolledStudents) { this.enrolledStudents = enrolledStudents; }
    public void setQuota(int quota) { this.quota = quota; }
    public void setCommissionName(String commissionName) { this.commissionName = commissionName; }
    public void setCourseStart(LocalDate courseStart) { this.courseStart = courseStart; }
    public void setCourseEnd(LocalDate courseEnd) { this.courseEnd = courseEnd; }
    public void setSubjectType(SubjectType subjectType) { this.subjectType = subjectType; }

    public void setTerm(int year, String period) {
        this.termYear = (short) year;
        this.termPeriod = period;
    }
}
