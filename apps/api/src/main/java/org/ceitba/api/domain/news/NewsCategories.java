package org.ceitba.api.domain.news;

import java.util.List;

// The canonical article/event categories, shared with the ItbaNews SPA
// (src/constants/categories.js). Stored and filtered verbatim: exact,
// case-sensitive, accented. V29 folded older spellings onto these.
public final class NewsCategories {

    public static final List<String> ALL = List.of(
        "Académico", "Campus", "Cultura", "Deportes", "Tecnología", "Organizaciones", "General");

    // Same values as ALL, as a regex for @Pattern (annotation values must be
    // compile-time constants). NewsCategoriesTest keeps the two in sync.
    public static final String PATTERN =
        "Académico|Campus|Cultura|Deportes|Tecnología|Organizaciones|General";

    public static final String MESSAGE =
        "must be one of Académico, Campus, Cultura, Deportes, Tecnología, Organizaciones, General";

    private NewsCategories() {}
}
