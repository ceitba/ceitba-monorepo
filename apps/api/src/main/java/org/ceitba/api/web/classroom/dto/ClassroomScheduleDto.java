package org.ceitba.api.web.classroom.dto;

public record ClassroomScheduleDto(
    String classroom,
    String building,
    String day,
    String hourFrom,
    String hourTo
) {}
