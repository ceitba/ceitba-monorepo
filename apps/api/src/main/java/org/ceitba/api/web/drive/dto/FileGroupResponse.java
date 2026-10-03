package org.ceitba.api.web.drive.dto;

import java.util.List;
import java.util.UUID;

public record FileGroupResponse(UUID sourceId, AuthorResponse author, List<FileSummaryResponse> files) {}
