// Port of apps/api/src/main/java/org/ceitba/api/domain/news/NewsCategories.java.
// The canonical article/event categories, shared with the newsletter SPA.
// Stored and filtered verbatim: exact, case-sensitive, accented.

export const NEWS_CATEGORIES = ['Académico', 'Campus', 'Cultura', 'Deportes', 'Tecnología', 'Organizaciones', 'General'] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/** The @Pattern regexp (Java source text, shown in the default message). */
export const NEWS_CATEGORY_PATTERN = 'Académico|Campus|Cultura|Deportes|Tecnología|Organizaciones|General';

export const NEWS_CATEGORY_MESSAGE =
  'must be one of Académico, Campus, Cultura, Deportes, Tecnología, Organizaciones, General';

/** Pattern.matches(PATTERN, s): whole-string, case-sensitive. */
export const isNewsCategory = (s: string): boolean => new RegExp(`^(?:${NEWS_CATEGORY_PATTERN})$`).test(s);
