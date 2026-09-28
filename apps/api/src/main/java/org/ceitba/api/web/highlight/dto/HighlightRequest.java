package org.ceitba.api.web.highlight.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;

// Body of POST /v1/highlights and PUT /v1/highlights/{id} (full replace).
// `active` defaults to true when omitted; startsAt/endsAt are optional
// (null = no lower / upper bound) but startsAt must precede endsAt.
// imageUrl and linkUrl go to the public feed and the app opens linkUrl, so
// both must be absolute http(s) URLs; a blank linkUrl means "no link".
public record HighlightRequest(
    @NotBlank @Size(max = 255) String title,
    String description,
    @NotBlank @Size(max = 2048) @Pattern(regexp = "^https?://\\S+$", message = "must be an http(s) URL")
    String imageUrl,
    @Size(max = 2048) @Pattern(regexp = "^(\\s*|https?://\\S+)$", message = "must be an http(s) URL")
    String linkUrl,
    int position,
    OffsetDateTime startsAt,
    OffsetDateTime endsAt,
    Boolean active
) {}
