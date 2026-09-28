package org.ceitba.api.domain;

// Kind of study group, mirroring the V24 study_groups_type_check constraint.
// The mobile app labels them "TP/GRUPO", "AHORA", "EXAMEN" and "GUIAS".
public enum StudyGroupType {
    TP_GRUPO,
    AHORA,
    EXAMEN,
    GUIAS
}
