package org.ceitba.api.web.news.dto;

import org.ceitba.api.domain.news.NewsEvent;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;

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
    OffsetDateTime createdAt
) {
    public static NewsEventResponse from(NewsEvent e) {
        return new NewsEventResponse(
            e.getId(), e.getTitle(), e.getEventDate(), e.getStartTime(), e.getEndTime(),
            e.getLocation(), e.getCategory(),
            e.getOrganization() != null ? e.getOrganization().getSlug() : null,
            e.getDescription(), e.getCreatedAt()
        );
    }
}
