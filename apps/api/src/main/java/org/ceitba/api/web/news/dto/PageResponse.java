package org.ceitba.api.web.news.dto;

import java.util.List;

public record PageResponse<T>(
    List<T> data,
    Meta    meta
) {
    public record Meta(long total, int page, int limit) {}
}
