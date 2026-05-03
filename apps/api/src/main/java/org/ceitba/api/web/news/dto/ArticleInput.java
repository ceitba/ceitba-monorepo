package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.List;

public record ArticleInput(
    String       id,
    @NotBlank String       title,
    @NotBlank String       excerpt,
    @NotNull  List<String> body,
    @NotBlank String       category,
    String       organization,
    @NotBlank String       author,
    LocalDate    publishedAt,
    String       readingTime,
    boolean      featured,
    String       colorScheme,
    String       coverImage,
    String       status
) {}
