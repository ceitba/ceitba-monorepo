package org.ceitba.api.web.drive.dto;

import java.util.List;

public record PageResponse<T>(List<T> items, long total) {}
