package org.ceitba.api.web.drive.dto;

// name is null when the source is anonymous (readers); STAFF see the owner
// on the staff endpoints instead.
public record AuthorResponse(String name, boolean anonymous) {}
