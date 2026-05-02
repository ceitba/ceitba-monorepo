package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record SubjectEntry(
    String type,
    String name,
    String code,
    String credits,
    Dependencies dependencies,
    String creditsRequired
) {}
