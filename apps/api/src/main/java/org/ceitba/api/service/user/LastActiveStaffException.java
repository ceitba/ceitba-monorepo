package org.ceitba.api.service.user;

import org.ceitba.api.common.exception.DomainException;

// DELETE /v1/me by the only active staff member. Deleting that row would leave
// nobody able to reach /v1/staff/** and the role could only be restored with
// raw SQL, so they must hand it over first. Mapped to 409.
public class LastActiveStaffException extends DomainException {

    public LastActiveStaffException() {
        super("You are the only active staff member. Grant the STAFF role to someone else before deleting your account.");
    }
}
