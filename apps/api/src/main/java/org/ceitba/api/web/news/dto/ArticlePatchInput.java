package org.ceitba.api.web.news.dto;

import jakarta.validation.constraints.Pattern;
import org.ceitba.api.domain.news.NewsCategories;

import java.time.LocalDate;
import java.util.List;

// All fields optional for PATCH. A null field means "unchanged", so a field
// that can be emptied gets an explicit flag: clearPublishedAt=true removes the
// date (e.g. undoing a publish that had filled it in). Ignored when
// publishedAt is also sent.
public record ArticlePatchInput(
    String       title,
    String       excerpt,
    List<String> body,
    @Pattern(regexp = NewsCategories.PATTERN, message = NewsCategories.MESSAGE)
    String       category,
    String       organization,
    List<String> authors,
    LocalDate    publishedAt,
    String       readingTime,
    Boolean      featured,
    String       colorScheme,
    String       coverImage,
    String       status,
    Boolean      clearPublishedAt
) {}
