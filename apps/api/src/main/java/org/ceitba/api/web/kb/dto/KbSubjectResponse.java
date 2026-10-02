package org.ceitba.api.web.kb.dto;

import java.util.List;

public record KbSubjectResponse(String subjectId, String subjectName, KbPageResponse index,
                                List<KbPageSummaryResponse> pages, List<KbRelatedResponse> related) {}
