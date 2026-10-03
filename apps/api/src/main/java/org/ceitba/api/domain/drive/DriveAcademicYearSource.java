package org.ceitba.api.domain.drive;

// Where a file's academic year comes from (V34), highest priority first.
public enum DriveAcademicYearSource {
    // Set by the student on this item.
    USER,
    // Set by the student on an ancestor folder.
    INHERITED,
    // A year in the file name, else in the nearest folder name.
    NAME,
    // The year of min(createdTime, modifiedTime) in Buenos Aires.
    DRIVE
}
