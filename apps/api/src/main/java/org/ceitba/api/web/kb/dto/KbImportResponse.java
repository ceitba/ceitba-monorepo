package org.ceitba.api.web.kb.dto;

import java.util.List;

public record KbImportResponse(List<String> accepted, List<KbRejectedPage> rejected, List<String> removed) {}
