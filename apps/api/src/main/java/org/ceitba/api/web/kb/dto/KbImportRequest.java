package org.ceitba.api.web.kb.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

// replace: pages of the subject that are not in `pages` become REMOVED.
public record KbImportRequest(@NotNull @Size(max = 500) List<@Valid KbImportPage> pages, boolean replace) {}
