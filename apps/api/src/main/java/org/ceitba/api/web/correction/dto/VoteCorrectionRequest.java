package org.ceitba.api.web.correction.dto;

import jakarta.validation.constraints.NotNull;
import org.ceitba.api.domain.correction.ScheduleCorrectionVoteType;

public record VoteCorrectionRequest(@NotNull ScheduleCorrectionVoteType type) {}
