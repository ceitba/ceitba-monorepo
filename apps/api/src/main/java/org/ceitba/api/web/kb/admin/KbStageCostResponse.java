package org.ceitba.api.web.kb.admin;

import java.math.BigDecimal;

// GET /models/{id}/stage-cost?stage= (ADMIN doc §8): the expected weekly cost
// with this model for the stage, everything else unchanged. mode: batch | sync.
public record KbStageCostResponse(String stage, String model, String mode, BigDecimal expectedWeeklyUsd,
                                  BigDecimal low, BigDecimal high, String basis) {}
