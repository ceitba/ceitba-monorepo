package org.ceitba.api.web.kb.dto;

import java.util.List;
import java.util.UUID;

public record KbStaffPageResponse(UUID id, String slug, String title, String type, String summary,
                                  List<String> aliases, String subjectId, String status, int reportCount,
                                  String hiddenReason) {}
