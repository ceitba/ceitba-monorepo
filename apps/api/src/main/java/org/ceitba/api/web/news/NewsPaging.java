package org.ceitba.api.web.news;

import org.springframework.data.domain.PageRequest;

// Paging for the public news lists. `page` is 1-based; `limit` is clamped so
// limit=0 isn't a 500 (PageRequest rejects it) and a huge limit can't dump
// the whole table. Same bounds as the users / study-group lists.
final class NewsPaging {

    static final int MAX_LIMIT = 100;

    private NewsPaging() {}

    static PageRequest of(int page, int limit) {
        return PageRequest.of(Math.max(page - 1, 0), Math.min(Math.max(limit, 1), MAX_LIMIT));
    }
}
