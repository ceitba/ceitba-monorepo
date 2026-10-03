package org.ceitba.api.web.drive.dto;

import java.util.List;

public record SourceTreeResponse(SourceResponse source, List<TreeItemResponse> items) {}
