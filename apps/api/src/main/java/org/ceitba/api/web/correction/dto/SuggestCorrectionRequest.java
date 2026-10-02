package org.ceitba.api.web.correction.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

public record SuggestCorrectionRequest(@NotNull List<ScheduleSlotInput> schedule) {}
