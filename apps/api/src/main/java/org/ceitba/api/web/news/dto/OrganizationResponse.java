package org.ceitba.api.web.news.dto;

import org.ceitba.api.domain.news.Organization;

public record OrganizationResponse(
    String  slug,
    String  name,
    String  fullName,
    String  description,
    String  category,
    String  color,
    long    followerCount,
    String  logoUrl,
    String  backgroundUrl
) {
    public static OrganizationResponse from(Organization org, long followerCount) {
        return new OrganizationResponse(
            org.getSlug(), org.getName(), org.getFullName(),
            org.getDescription(), org.getCategory(), org.getColor(),
            followerCount, org.getLogoUrl(), org.getBackgroundUrl()
        );
    }
}
