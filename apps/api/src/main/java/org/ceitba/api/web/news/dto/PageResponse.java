package org.ceitba.api.web.news.dto;

import org.springframework.data.domain.Page;

import java.util.List;

public record PageResponse<T>(
    List<T> data,
    Meta    meta
) {
    public record Meta(long total, int page, int limit) {
        // From the page actually served, so a clamped limit is reported as
        // applied rather than echoing the raw query param.
        public static Meta of(Page<?> page) {
            return new Meta(page.getTotalElements(), page.getNumber() + 1, page.getSize());
        }
    }
}
