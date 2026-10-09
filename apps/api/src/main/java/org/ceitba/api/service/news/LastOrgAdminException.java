package org.ceitba.api.service.news;

import org.ceitba.api.common.exception.DomainException;

// Removing or demoting this member, or deleting their account, would leave an
// organization without any admin, and with it nobody (but STAFF) able to
// manage its members. Mapped to 409 LastOrgAdmin.
public class LastOrgAdminException extends DomainException {

    private final String organization;

    public LastOrgAdminException(String organization) {
        super("You are the only admin of '" + organization + "'. Make another member admin first.");
        this.organization = organization;
    }

    public String organization() { return organization; }
}
