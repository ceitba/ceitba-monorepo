package org.ceitba.api.web.capability.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

// Emails are trimmed, lowercased and deduped; a malformed one rejects the batch (400).
public record GrantUsersRequest(@NotEmpty @Size(max = 500) List<String> emails) {}
