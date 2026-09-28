package org.ceitba.api.common.exception;

// The resource exists but its current state does not allow the operation
// (e.g. moderating an already-moderated proposal, voting on a closed one).
// Mapped to 409.
public class InvalidStateException extends DomainException {

    public InvalidStateException(String message) {
        super(message);
    }
}
