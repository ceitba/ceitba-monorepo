package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.DomainException;

// DELETE /v1/me by the only active staff member, or DELETE /v1/staff/{id} of
// them. Removing that row would leave nobody able to reach /v1/staff/** and
// the role could only be restored with raw SQL, so it must be handed over
// first. Mapped to 409.
public class LastActiveStaffException extends DomainException {

    public LastActiveStaffException() {
        super("You are the only active staff member. Grant the STAFF role to someone else before deleting your account.");
    }

    public LastActiveStaffException(String message) {
        super(message);
    }
}
