package org.ceitba.api.web.kb.dto;

// reason: PREREQUISITE | DEPENDENT | LINKED. hasWiki: it has published pages.
public record KbRelatedResponse(String subjectId, String subjectName, String reason, boolean hasWiki) {}
