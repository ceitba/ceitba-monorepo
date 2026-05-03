package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.time.LocalTime;

public record NewsEventInput(
    String     id,
    @NotBlank String    title,
    @NotNull  LocalDate eventDate,
    @NotNull  LocalTime startTime,
    @NotNull  LocalTime endTime,
    @NotBlank String    location,
    @NotBlank String    category,
    String    organization,
    String    description
) {}
