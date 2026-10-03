package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;

// DigitalOcean's public GenAI model catalog (no auth):
// GET https://api.digitalocean.com/v2/gen-ai/models/catalog -> {data:[...]}.
public interface DoModelCatalog {

    // All items (pages followed); throws LlmApiException when unreachable.
    java.util.List<JsonNode> fetch();
}
