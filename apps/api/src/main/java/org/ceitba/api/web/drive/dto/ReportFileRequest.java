package org.ceitba.api.web.drive.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.ceitba.api.domain.drive.DriveReportReason;

public record ReportFileRequest(@NotNull DriveReportReason reason, @Size(max = 2000) String comment) {}
