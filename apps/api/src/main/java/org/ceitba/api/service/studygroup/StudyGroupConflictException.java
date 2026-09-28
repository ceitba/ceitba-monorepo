package org.ceitba.api.service.studygroup;

import org.ceitba.api.common.exception.DomainException;

// A study-group membership change that the group's current state forbids.
// Mapped to 409; `error` is reason().code(), a stable code the app switches on.
public class StudyGroupConflictException extends DomainException {

    public enum Reason {
        FULL("StudyGroupFull"),
        PAST_DUE("StudyGroupPastDue"),
        CAPACITY_BELOW_MEMBERS("StudyGroupCapacityBelowMembers");

        private final String code;

        Reason(String code) { this.code = code; }

        public String code() { return code; }
    }

    private final Reason reason;

    public StudyGroupConflictException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() { return reason; }
}
