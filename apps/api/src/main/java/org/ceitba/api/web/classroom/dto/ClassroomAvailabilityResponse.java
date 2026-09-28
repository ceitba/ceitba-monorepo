package org.ceitba.api.web.classroom.dto;

import java.util.List;

// GET /v1/classrooms/availability. Times are "HH:mm" in America/Argentina/Buenos_Aires.
// `buildings` lists every in-person building of the classroom universe (even
// with no free rooms, so clients can render "0 aulas libres"), ordered by name.
public record ClassroomAvailabilityResponse(
    String day,
    String at,
    int minMinutes,
    String openFrom,
    String openUntil,
    List<BuildingAvailability> buildings
) {

    public record BuildingAvailability(
        String building,
        int totalClassrooms,
        int freeNowCount,
        // Free windows that have not ended at `at`: the ones containing `at`
        // (freeNow=true) and the ones starting later that day, sorted by
        // freeFrom, freeUntil, classroom.
        List<FreeClassroom> classrooms
    ) {}

    public record FreeClassroom(
        String classroom,
        String freeFrom,
        String freeUntil,
        boolean freeNow
    ) {}
}
