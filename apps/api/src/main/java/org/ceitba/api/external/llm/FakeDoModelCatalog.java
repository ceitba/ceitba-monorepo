package org.ceitba.api.external.llm;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

// Tests / offline: items set by the test; unreachable until set.
public class FakeDoModelCatalog implements DoModelCatalog {

    private volatile List<JsonNode> items;

    public void items(List<JsonNode> items) {
        this.items = items;
    }

    @Override
    public List<JsonNode> fetch() {
        if (items == null) throw new LlmApiException(0, "fake catalog unreachable");
        return items;
    }
}
