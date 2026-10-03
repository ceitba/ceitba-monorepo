package org.ceitba.api.service.wiki;

import org.ceitba.api.common.exception.DomainException;

// A user already pinned SubjectBookmarkService.MAX_PER_USER subjects.
// GlobalExceptionHandler maps it to 409 BOOKMARK_LIMIT.
public class BookmarkLimitException extends DomainException {

    public BookmarkLimitException(int max) {
        super("You can pin at most " + max + " subjects");
    }
}
