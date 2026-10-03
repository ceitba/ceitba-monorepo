package org.ceitba.api.web.kb.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.ceitba.api.domain.kb.KbReportReason;

public record KbReportRequest(@NotNull KbReportReason reason, @Size(max = 2000) String comment) {}
