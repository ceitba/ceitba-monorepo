package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record Dependencies(List<String> dependency) {}
