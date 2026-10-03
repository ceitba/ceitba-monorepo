package org.ceitba.api.domain.drive;

// Whether readers see a file. Computed by service/drive/PublicationRule.
public enum DrivePublication {
    PRIVATE,
    NEEDS_REVIEW,
    PUBLISHED,
    HIDDEN_REPORTED,
    REMOVED_BY_STAFF,
    REMOVED
}
