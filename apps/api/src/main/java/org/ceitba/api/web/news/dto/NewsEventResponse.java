package org.ceitba.api.web.news.dto;

import org.ceitba.api.domain.news.NewsEvent;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;

// rsvpCount: people going (signupMode 'rsvp'; 0 otherwise).
public record NewsEventResponse(
    String        id,
    String        title,
    LocalDate     eventDate,
    LocalTime     startTime,
    LocalTime     endTime,
    String        location,
    String        category,
    String        organization,
    String        description,
    OffsetDateTime createdAt,
    String        coverImage,
    String        onlineUrl,
    String        signupMode,
    String        signupUrl,
    Integer       capacity,
    long          rsvpCount
) {
    public static NewsEventResponse from(NewsEvent e) {
        return from(e, 0);
    }

    public static NewsEventResponse from(NewsEvent e, long rsvpCount) {
        return new NewsEventResponse(
            e.getId(), e.getTitle(), e.getEventDate(), e.getStartTime(), e.getEndTime(),
            e.getLocation(), e.getCategory(),
            e.getOrganization() != null ? e.getOrganization().getSlug() : null,
            e.getDescription(), e.getCreatedAt(),
            e.getCoverImage(), e.getOnlineUrl(), e.getSignupMode(), e.getSignupUrl(), e.getCapacity(),
            rsvpCount
        );
    }
}
