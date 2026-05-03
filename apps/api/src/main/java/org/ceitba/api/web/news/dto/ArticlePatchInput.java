package org.ceitba.api.web.news.dto;

import java.time.LocalDate;
import java.util.List;

// All fields optional for PATCH
public record ArticlePatchInput(
    String       title,
    String       excerpt,
    List<String> body,
    String       category,
    String       organization,
    String       author,
    LocalDate    publishedAt,
    String       readingTime,
    Boolean      featured,
    String       colorScheme,
    String       coverImage,
    String       status
) {}
