package org.ceitba.api.web.news.dto;

import java.time.LocalDate;
import java.time.LocalTime;

public record NewsEventPatchInput(
    String    title,
    LocalDate eventDate,
    LocalTime startTime,
    LocalTime endTime,
    String    location,
    String    category,
    String    organization,
    String    description
) {}
