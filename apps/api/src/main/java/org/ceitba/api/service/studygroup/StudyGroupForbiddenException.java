package org.ceitba.api.service.studygroup;

import org.ceitba.api.common.exception.DomainException;

// Editing or deleting a study group is limited to its owner and moderators.
// Mapped to 403 (groups are visible to every user, so hiding it as a 404
// would gain nothing).
public class StudyGroupForbiddenException extends DomainException {

    public StudyGroupForbiddenException(String action) {
        super("Only the group owner or a moderator can " + action + " this study group");
    }
}
