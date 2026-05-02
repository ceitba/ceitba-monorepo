package org.ceitba.api.domain;

// Maps to PG enum public.subject_type. SAMINARY misspelling preserved
// because it is the value present in production data.
public enum SubjectType {
    ANNUAL,
    SEMESTRAL,
    SAMINARY
}
