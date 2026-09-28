package org.ceitba.api.external.itba;

// Academic data of one student as the ITBA SGA reports it. Carries no DNI.
//   fileNumber  the legajo (SGA `code`), null when missing or not numeric
//   careerCode  SGA career code; CEITBA career ids use the same codes
//   careerName  SGA display name, informational only
//   planName    first active career plan name, null when none is active
public record StudentProjection(
    Integer fileNumber,
    String careerCode,
    String careerName,
    String planName
) {}
