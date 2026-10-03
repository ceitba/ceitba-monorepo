package org.ceitba.api.web.kb.admin;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.OffsetDateTime;
import java.util.UUID;

// settings: the stored overrides of that version (not the merged values).
public record KbSettingsHistoryResponse(UUID id, JsonNode settings, UUID changedBy, String changedByName,
                                        OffsetDateTime changedAt, String note) {}
