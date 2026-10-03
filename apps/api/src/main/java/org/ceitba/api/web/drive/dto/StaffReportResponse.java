package org.ceitba.api.web.drive.dto;

import java.time.OffsetDateTime;

// Reporters are never identified.
public record StaffReportResponse(String reason, String comment, OffsetDateTime createdAt) {}
