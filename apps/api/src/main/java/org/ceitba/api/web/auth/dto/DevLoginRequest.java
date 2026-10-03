package org.ceitba.api.web.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record DevLoginRequest(@NotBlank @Size(max = 320) String email, @Size(max = 200) String name, boolean staff) {}
