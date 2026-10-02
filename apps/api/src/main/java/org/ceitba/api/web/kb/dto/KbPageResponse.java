package org.ceitba.api.web.kb.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// markdown: the body without frontmatter. status: PUBLISHED | HIDDEN |
// REMOVED (readers only ever get PUBLISHED pages).
public record KbPageResponse(
    UUID id,
    String slug,
    String title,
    String type,
    String summary,
    List<String> aliases,
    String subjectId,
    String subjectName,
    String markdown,
    List<KbSourceResponse> sources,
    List<KbLinkResponse> links,
    List<KbBacklinkResponse> backlinks,
    String generator,
    OffsetDateTime generatedAt,
    int revision,
    boolean reportedByMe,
    String status
) {}
