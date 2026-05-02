package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

// The ITBA API names the inner field `withoutTerm` too — same as the parent
// wrapper. Mapping the wrapper to a different Java field name to keep things
// readable.
@JsonIgnoreProperties(ignoreUnknown = true)
public record WithoutTerm(
    @JsonProperty("withoutTerm") List<SubjectEntry> entries
) {}
