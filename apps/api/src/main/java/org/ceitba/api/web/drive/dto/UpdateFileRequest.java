package org.ceitba.api.web.drive.dto;

import jakarta.validation.constraints.Size;

import com.fasterxml.jackson.databind.JsonNode;

// Absent (or null) subjectId/hidden are left unchanged; subjectId "" clears
// the subject. academicYear: absent = unchanged, null = back to automatic,
// a year = the student's own (folders pass it to their contents). It is a
// JsonNode so absent (null) and explicit null (NullNode) can be told apart.
public record UpdateFileRequest(@Size(max = 25) String subjectId, Boolean hidden, JsonNode academicYear) {}
