package org.ceitba.api.web.drive.dto;

import jakarta.validation.constraints.Size;

public record StaffCommentRequest(@Size(max = 2000) String comment) {}
