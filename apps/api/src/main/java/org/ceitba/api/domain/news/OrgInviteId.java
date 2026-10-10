package org.ceitba.api.domain.news;

import java.io.Serializable;
import java.util.Objects;

public class OrgInviteId implements Serializable {

    private String organization;
    private String email;

    public OrgInviteId() {}

    public OrgInviteId(String organization, String email) {
        this.organization = organization;
        this.email = email;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof OrgInviteId other)) return false;
        return Objects.equals(organization, other.organization)
            && Objects.equals(email, other.email);
    }

    @Override
    public int hashCode() {
        return Objects.hash(organization, email);
    }
}
