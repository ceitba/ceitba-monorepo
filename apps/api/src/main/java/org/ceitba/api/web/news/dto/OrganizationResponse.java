package org.ceitba.api.web.news.dto;

import org.ceitba.api.domain.news.Organization;

public record OrganizationResponse(
    String  slug,
    String  name,
    String  fullName,
    String  description,
    String  category,
    String  color,
    int     memberCount
) {
    public static OrganizationResponse from(Organization org) {
        return new OrganizationResponse(
            org.getSlug(), org.getName(), org.getFullName(),
            org.getDescription(), org.getCategory(), org.getColor(),
            org.getMemberCount()
        );
    }
}
