package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record CareerPlan(
    String name,
    String career,
    String degreeLevel,
    String since,
    List<Section> section
) {}
