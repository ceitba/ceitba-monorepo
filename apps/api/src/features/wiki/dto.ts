// web/wiki/dto/BookmarkStateResponse + PinnedSubjectResponse.

/** BookmarkStateResponse(long count, boolean bookmarked). */
export interface BookmarkStateResponse {
  count: number;
  bookmarked: boolean;
}

/** PinnedSubjectResponse(subjectId, subjectName, fileCount, hasWiki, pinnedAt): pinnedAt read from the DB. */
export interface PinnedSubjectResponse {
  subjectId: string;
  subjectName: string | null;
  fileCount: number;
  hasWiki: boolean;
  pinnedAt: string;
}
