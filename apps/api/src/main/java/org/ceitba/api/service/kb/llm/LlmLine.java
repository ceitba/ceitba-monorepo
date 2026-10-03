package org.ceitba.api.service.kb.llm;

import com.fasterxml.jackson.databind.JsonNode;

// One request in canonical form (see KbChatPayloads).
public record LlmLine(String customId, JsonNode params) {}
