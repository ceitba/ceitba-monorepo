package org.ceitba.api.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.List;

@Entity
@Table(schema = "public", name = "plan_subject")
@IdClass(PlanSubjectId.class)
public class PlanSubject {

    @Id
    @Column(name = "subject_id", length = 32)
    private String subjectId;

    @Id
    @Column(name = "plan_id", length = 32)
    private String planId;

    @Column(nullable = false)
    private String section;

    @Column(nullable = false)
    private int year;

    @Column(nullable = false)
    private int semester;

    @Column(name = "credits_required")
    private Integer creditsRequired;

    // Stored as String[] (not List<String>) on purpose: Hibernate 6.5 caches the
    // BasicType it resolves for List<String>, so if Article (List<String> as
    // JSON) is bound first, this column gets typed as JSON and schema
    // validation fails at startup. String[] can't collide. See ListStringMappingOrderIT.
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(columnDefinition = "varchar(255)[]")
    private String[] dependencies = new String[0];

    protected PlanSubject() {}

    public PlanSubject(String subjectId, String planId, String section,
                       int year, int semester, Integer creditsRequired,
                       List<String> dependencies) {
        this.subjectId = subjectId;
        this.planId = planId;
        this.section = section;
        this.year = year;
        this.semester = semester;
        this.creditsRequired = creditsRequired;
        this.dependencies = StringArrays.fromList(dependencies);
    }

    public String getSubjectId() { return subjectId; }
    public String getPlanId() { return planId; }
    public String getSection() { return section; }
    public int getYear() { return year; }
    public int getSemester() { return semester; }
    public Integer getCreditsRequired() { return creditsRequired; }
    public List<String> getDependencies() { return StringArrays.toList(dependencies); }
}
