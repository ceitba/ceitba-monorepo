package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.ceitba.api.domain.news.NewsCategories;

import java.time.LocalDate;
import java.time.LocalTime;

public record NewsEventInput(
    String     id,
    @NotBlank String    title,
    @NotNull  LocalDate eventDate,
    @NotNull  LocalTime startTime,
    @NotNull  LocalTime endTime,
    @NotBlank String    location,
    @NotBlank @Pattern(regexp = NewsCategories.PATTERN, message = NewsCategories.MESSAGE)
    String    category,
    String    organization,
    String    description,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String    coverImage,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String    onlineUrl,
    @Pattern(regexp = "^(none|external|rsvp)$", message = "must be none, external or rsvp")
    String    signupMode,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String    signupUrl,
    @Positive @Max(100000)
    Integer   capacity
) {}
