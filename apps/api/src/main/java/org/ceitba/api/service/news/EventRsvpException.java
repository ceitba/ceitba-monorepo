package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.DomainException;

// RSVP refused by the event's state. Mapped to 409 with the reason's code,
// which the web app switches on.
public class EventRsvpException extends DomainException {

    public enum Reason {
        NOT_RSVP("EventNotRsvp", "This event does not take RSVPs"),
        ENDED("EventEnded", "This event already took place"),
        FULL("EventFull", "This event is full");

        private final String code;
        private final String message;

        Reason(String code, String message) {
            this.code = code;
            this.message = message;
        }

        public String code() { return code; }
    }

    private final Reason reason;

    public EventRsvpException(Reason reason) {
        super(reason.message);
        this.reason = reason;
    }

    public Reason reason() { return reason; }
}
