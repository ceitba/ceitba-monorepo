package org.ceitba.api.web.correction.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;

// One proposed slot: {"day": "MONDAY".."SATURDAY", "time_from": "HH:mm[:ss]", "time_to": ...}.
// Same snake_case keys as the `schedule` entries of GET /v1/subjects; fully
// validated (and normalized) by the service, so no bean-validation here.
public record ScheduleSlotInput(
    String day,
    @JsonProperty("time_from") @JsonAlias("timeFrom") String timeFrom,
    @JsonProperty("time_to") @JsonAlias("timeTo") String timeTo
) {}
