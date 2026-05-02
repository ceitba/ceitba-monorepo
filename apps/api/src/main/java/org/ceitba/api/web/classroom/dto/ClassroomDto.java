package org.ceitba.api.web.classroom.dto;

public record ClassroomDto(
    String name,
    String building,
    String day,
    String hourFrom,
    String hourTo
) {}
