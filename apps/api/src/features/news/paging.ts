// web/news/dto/PageResponse + web/news/NewsPaging. Shared by every controller
// that imports org.ceitba.api.web.news.dto.PageResponse (news, proposals,
// study groups, schedule corrections, users).

/** PageResponse<T>(List<T> data, Meta meta). */
export interface PageResponse<T> {
  data: T[];
  meta: PageMeta;
}

/** PageResponse.Meta(long total, int page, int limit). */
export interface PageMeta {
  total: number;
  page: number;
  limit: number;
}

/** A Spring PageRequest: 0-based page number and size. */
export interface PageRequest {
  page: number;
  size: number;
}

/** PageRequest.of(page, size): offset = page * size. */
export const pageOffset = (p: PageRequest): number => p.page * p.size;

/**
 * Meta.of(Page): total elements, page number + 1, page size (the size actually
 * served, so a clamped limit reports as applied).
 */
export function metaOf(p: PageRequest, total: number): PageMeta {
  return { total, page: p.page + 1, limit: p.size };
}

export function pageResponse<T>(data: T[], p: PageRequest, total: number): PageResponse<T> {
  return { data, meta: metaOf(p, total) };
}

/** NewsPaging.MAX_LIMIT */
export const NEWS_MAX_LIMIT = 100;

/** NewsPaging.of(page, limit): 1-based page, limit clamped to [1, 100]. */
export function newsPaging(page: number, limit: number): PageRequest {
  return { page: Math.max(page - 1, 0), size: Math.min(Math.max(limit, 1), NEWS_MAX_LIMIT) };
}
