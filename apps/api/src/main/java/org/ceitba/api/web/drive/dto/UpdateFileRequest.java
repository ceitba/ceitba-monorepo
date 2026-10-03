package org.ceitba.api.web.drive.dto;

import jakarta.validation.constraints.Size;

// Absent (or null) fields are left unchanged; subjectId "" clears the subject.
public record UpdateFileRequest(@Size(max = 25) String subjectId, Boolean hidden) {}
