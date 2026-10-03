package org.ceitba.api.web.kb.dto;

import java.util.List;

// Subjects recorded as compiled from their current inputs.
public record KbBaselineResponse(List<String> subjects) {}
