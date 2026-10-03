package org.ceitba.api.web.kb.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// path: "slug.md"; content: the whole file, frontmatter included.
public record KbImportPage(@NotBlank @Size(max = 300) String path, String content) {}
