package org.ceitba.api.web.kb.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// stale: the newest source is older than KB_STALE_YEARS (default 3) years.
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
    SourceYears sourceYears,
    boolean stale,
    List<KbLinkResponse> links,
    List<KbBacklinkResponse> backlinks,
    String generator,
    OffsetDateTime generatedAt,
    int revision,
    boolean reportedByMe,
    String status
) {
    // Range of the sources' academic years (null fields without any).
    public record SourceYears(Integer min, Integer max) {}
}
