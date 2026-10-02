package org.ceitba.api.web.wiki.dto;

import java.time.OffsetDateTime;

// GET /v1/wiki/bookmarks. fileCount: published Apuntes files; hasWiki: the
// subject wiki has at least one published page.
public record PinnedSubjectResponse(String subjectId, String subjectName, long fileCount, boolean hasWiki,
                                    OffsetDateTime pinnedAt) {}
