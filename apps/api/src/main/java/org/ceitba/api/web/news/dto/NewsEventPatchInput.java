package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.Pattern;
import org.ceitba.api.domain.news.NewsCategories;

import java.time.LocalDate;
import java.time.LocalTime;

public record NewsEventPatchInput(
    String    title,
    LocalDate eventDate,
    LocalTime startTime,
    LocalTime endTime,
    String    location,
    @Pattern(regexp = NewsCategories.PATTERN, message = NewsCategories.MESSAGE)
    String    category,
    String    organization,
    String    description
) {}
