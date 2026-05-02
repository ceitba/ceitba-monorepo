package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Section(
    String name,
    Terms terms,
    WithoutTerm withoutTerm
) {}
