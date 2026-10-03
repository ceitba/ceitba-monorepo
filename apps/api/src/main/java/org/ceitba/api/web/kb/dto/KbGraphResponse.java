package org.ceitba.api.web.kb.dto;

import java.util.List;
import java.util.UUID;

public record KbGraphResponse(List<Node> nodes, List<Edge> edges) {

    // external: a page of another subject linked to or from this one.
    public record Node(UUID id, String subjectId, String slug, String title, String type, boolean external) {}

    public record Edge(UUID from, UUID to) {}
}
