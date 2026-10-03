package org.ceitba.api.web.kb.admin;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

// byStage/byModel/topSubjects/cacheHitRatio over the last 30 days.
// projectedMonthUsd = average week of the last 4 x 4.345. simulated: some
// of these rows came from the fake executors (tests, local demo).
public record KbCostSummaryResponse(BigDecimal last7dUsd, BigDecimal last30dUsd, BigDecimal projectedMonthUsd,
                                    Map<String, BigDecimal> byStage, Map<String, BigDecimal> byModel,
                                    List<SubjectCost> topSubjects, double cacheHitRatio, boolean simulated,
                                    Accuracy accuracy) {

    // Expected (forecast at detection) vs actual of the last completed runs.
    public record Accuracy(List<RunAccuracy> lastRuns) {}

    public record RunAccuracy(java.util.UUID runId, BigDecimal expectedUsd, BigDecimal actualUsd) {}

    public record SubjectCost(String subjectId, String subjectName, BigDecimal costUsd) {}
}
