package org.ceitba.api.web.news.dto;

import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.service.news.OrganizationMembershipService.BoardMemberView;

import java.util.List;

// `board` (members who chose to appear on the portal, no emails) is only
// filled by GET /v1/organizations/{slug}; null in lists.
public record OrganizationResponse(
    String  slug,
    String  name,
    String  fullName,
    String  description,
    String  category,
    String  color,
    long    followerCount,
    String  logoUrl,
    String  backgroundUrl,
    String  instagram,
    String  linkedinUrl,
    String  websiteUrl,
    String  contactEmail,
    boolean recruitingOpen,
    String  recruitingUrl,
    String  recruitingText,
    // Whether plain members see events' RSVP lists (the admins' setting).
    boolean attendeesVisibleToMembers,
    List<BoardMemberView> board
) {
    public static OrganizationResponse from(Organization org, long followerCount) {
        return from(org, followerCount, null);
    }

    public static OrganizationResponse from(Organization org, long followerCount, List<BoardMemberView> board) {
        return new OrganizationResponse(
            org.getSlug(), org.getName(), org.getFullName(),
            org.getDescription(), org.getCategory(), org.getColor(),
            followerCount, org.getLogoUrl(), org.getBackgroundUrl(),
            org.getInstagram(), org.getLinkedinUrl(), org.getWebsiteUrl(), org.getContactEmail(),
            org.isRecruitingOpen(), org.getRecruitingUrl(), org.getRecruitingText(),
            org.isAttendeesVisibleToMembers(), board
        );
    }
}
