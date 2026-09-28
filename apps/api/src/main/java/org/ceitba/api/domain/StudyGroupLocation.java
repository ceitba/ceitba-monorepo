package org.ceitba.api.domain;

// Where a study group meets, mirroring the V24 study_groups_locations_check
// constraint: virtual, or one of the ITBA campuses (Sede Distrito Rectorado,
// Sede Distrito Tecnológico, Sede Distrito Financiero).
public enum StudyGroupLocation {
    VIRTUAL,
    SDR,
    SDT,
    SDF
}
