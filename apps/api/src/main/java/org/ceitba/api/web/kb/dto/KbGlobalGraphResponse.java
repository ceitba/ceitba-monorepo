package org.ceitba.api.web.kb.dto;

import java.util.List;
import java.util.UUID;

// GET /v1/wiki/kb/graph: every PUBLISHED page and resolved link (no
// self-loops, deduplicated). pageCount = the subject's PUBLISHED pages.
public record KbGlobalGraphResponse(List<Subject> subjects, List<Node> nodes, List<Edge> edges) {

    public record Subject(String subjectId, String subjectName, long pageCount) {}

    public record Node(UUID id, String subjectId, String slug, String title, String type) {}

    public record Edge(UUID from, UUID to, boolean crossSubject) {}
}
