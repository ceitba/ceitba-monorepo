package org.ceitba.api.web.drive.dto;

// name is null when the source is anonymous (readers); STAFF see the owner
// on the staff endpoints instead.
// community: a community archive; name is its label ("Comunidad"), never a
// contributor's name or address.
public record AuthorResponse(String name, boolean anonymous, boolean community) {}
