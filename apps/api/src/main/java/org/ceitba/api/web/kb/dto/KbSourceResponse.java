package org.ceitba.api.web.kb.dto;

import org.ceitba.api.web.drive.dto.AuthorResponse;

import java.util.UUID;

// A Drive file the page cites (id = the FileSummary id under /v1/wiki/files).
public record KbSourceResponse(UUID id, String name, String kind, AuthorResponse author) {}
