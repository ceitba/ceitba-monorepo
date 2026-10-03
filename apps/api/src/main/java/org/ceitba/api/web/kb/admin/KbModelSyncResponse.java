package org.ceitba.api.web.kb.admin;

import java.time.OffsetDateTime;
import java.util.List;

// POST /models/sync (ADMIN doc §2). source: do-catalog (prices from DO's
// public catalog) | inference-models (fallback: ids from /v1/models only).
public record KbModelSyncResponse(List<Updated> updated, List<String> added, int unchanged, List<String> notInCatalog,
                                  String source, OffsetDateTime fetchedAt) {

    public record Updated(String id, List<Change> changes) {}

    // old/new as strings (prices in USD per million tokens).
    public record Change(String field, String old,
                         @com.fasterxml.jackson.annotation.JsonProperty("new") String newValue) {}
}
