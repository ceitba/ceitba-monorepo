package org.ceitba.api.service.correction;

import org.ceitba.api.common.exception.DomainException;

// A schedule-correction request the commission's state forbids.
// GlobalExceptionHandler maps SAME_AS_SGA to 400 and the others to 409; the
// `error` field is reason().code(), a stable code the UIs switch on.
public class ScheduleCorrectionException extends DomainException {

    public enum Reason {
        // The proposed slot set equals the commission's current SGA slots.
        SAME_AS_SGA("SameAsSga"),
        // The commission's course has ended (course_end < today).
        COMMISSION_ENDED("CommissionEnded"),
        // The caller already has a different PENDING suggestion for it.
        ALREADY_SUGGESTED("AlreadySuggested");

        private final String code;

        Reason(String code) { this.code = code; }

        public String code() { return code; }
    }

    private final Reason reason;

    public ScheduleCorrectionException(Reason reason, String message) {
        super(message);
        this.reason = reason;
    }

    public Reason reason() { return reason; }
}
