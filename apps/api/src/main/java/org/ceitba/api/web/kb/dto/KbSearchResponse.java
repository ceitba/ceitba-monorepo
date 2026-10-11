package org.ceitba.api.web.kb.dto;

import java.util.List;
import java.util.UUID;

// GET /v1/wiki/kb/search: the published wiki passages nearest to a query,
// best first. score = 1 - cosine distance (1 = same meaning).
public record KbSearchResponse(String query, List<Hit> results) {

    public record Hit(UUID pageId, String subjectId, String slug, String title, String heading, String anchor,
                      String content, double score) {}
}
