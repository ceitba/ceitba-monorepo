package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

// The ITBA API returns either { "section": {...} } or { "section": [{...}] }
// depending on the count. We rely on Jackson's
// DeserializationFeature.ACCEPT_SINGLE_VALUE_AS_ARRAY (configured in the
// RestClient bean) so all the List<> fields cope with both shapes.
@JsonIgnoreProperties(ignoreUnknown = true)
public record CareerPlansResponse(
    @JsonProperty("careerplan") CareerPlan careerPlan
) {}
