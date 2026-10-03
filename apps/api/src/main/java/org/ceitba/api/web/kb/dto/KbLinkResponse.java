package org.ceitba.api.web.kb.dto;

// raw: the wikilink target as written (before '|', #anchor included).
// anchor: the folded section anchor, or null. resolved: the target page
// exists and the caller can see it; title is null otherwise.
public record KbLinkResponse(String raw, String subjectId, String slug, String anchor, boolean resolved,
                             String title) {}
