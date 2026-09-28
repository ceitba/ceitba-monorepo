package org.ceitba.api.external.itba.wire;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

// GET /people/{token}?email=... Only the DNI is read; it is used in memory to
// look the student up and is never persisted or logged.
@JsonIgnoreProperties(ignoreUnknown = true)
public record PersonResponse(String dni) {}
