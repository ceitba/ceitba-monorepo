package org.ceitba.api.domain;

import java.io.Serializable;
import java.util.Objects;

public class PlanSubjectId implements Serializable {

    private String subjectId;
    private String planId;

    public PlanSubjectId() {}

    public PlanSubjectId(String subjectId, String planId) {
        this.subjectId = subjectId;
        this.planId = planId;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof PlanSubjectId other)) return false;
        return Objects.equals(subjectId, other.subjectId)
            && Objects.equals(planId, other.planId);
    }

    @Override
    public int hashCode() {
        return Objects.hash(subjectId, planId);
    }
}
