package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import org.ceitba.api.domain.news.NewsCategories;

import java.time.LocalDate;
import java.util.List;

public record ArticleInput(
    String       id,
    @NotBlank String       title,
    @NotBlank String       excerpt,
    @NotNull  List<String> body,
    @NotBlank @Pattern(regexp = NewsCategories.PATTERN, message = NewsCategories.MESSAGE)
    String       category,
    String       organization,
    @NotEmpty List<String> authors,
    LocalDate    publishedAt,
    String       readingTime,
    boolean      featured,
    String       colorScheme,
    String       coverImage,
    String       status
) {}
