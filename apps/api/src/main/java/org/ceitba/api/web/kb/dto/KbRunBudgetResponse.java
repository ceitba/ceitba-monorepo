package org.ceitba.api.web.kb.dto;

import java.math.BigDecimal;

// A run's cost budget (settings runCostBudgetUsd) at admission, plus what it
// has spent so far. estimatedUsd: forecast of the admitted subjects (their
// whole DIGEST+PLAN+WRITE+RETRY); spentUsd: recorded usage so far (= costUsd);
// deferredEstimatedUsd: what the subjects deferred for budget would have cost;
// oversizedSubjectId: set when the run is a dedicated run of one subject that
// alone exceeds the budget. Null on runs created before the cost budget.
public record KbRunBudgetResponse(
    BigDecimal limitUsd,
    BigDecimal estimatedUsd,
    BigDecimal spentUsd,
    int admitted,
    int deferred,
    BigDecimal deferredEstimatedUsd,
    long tokenBudget,
    String oversizedSubjectId
) {}
