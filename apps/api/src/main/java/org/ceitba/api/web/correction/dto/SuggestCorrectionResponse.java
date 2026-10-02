package org.ceitba.api.web.correction.dto;

// created=false: an identical open correction already existed and is
// returned instead of a duplicate (the caller's vote is unchanged).
public record SuggestCorrectionResponse(boolean created, CorrectionResponse correction) {}
