package org.ceitba.api.domain.correction;

public enum ScheduleCorrectionStatus {
    PENDING,
    APPLIED,
    REJECTED,
    RESOLVED,
    SUPERSEDED;

    // Open corrections are shown publicly and accept votes.
    public boolean isOpen() { return this == PENDING || this == APPLIED; }
}
