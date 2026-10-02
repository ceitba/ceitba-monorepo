package org.ceitba.api.web.kb.dto;

import java.util.List;
import java.util.UUID;

// type: index | topic | concept
public record KbPageSummaryResponse(UUID id, String slug, String title, String type, String summary,
                                    List<String> aliases) {}
