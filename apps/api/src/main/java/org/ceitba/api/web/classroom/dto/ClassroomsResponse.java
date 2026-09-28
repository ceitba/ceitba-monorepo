package org.ceitba.api.web.classroom.dto;

import com.fasterxml.jackson.annotation.JsonValue;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;
import java.util.Map;

// GET /v1/classrooms. Two shapes depending on `status`; each record
// serializes as its bare map (@JsonValue) so the JSON is unchanged from the
// untyped Object the endpoint used to return.
@Schema(oneOf = {ClassroomsResponse.ByBuilding.class, ClassroomsResponse.OccupiedByDay.class})
public sealed interface ClassroomsResponse {

    // No status filter: {building: [ClassroomDto]}.
    @Schema(description = "Map of building -> classroom schedule rows")
    record ByBuilding(@JsonValue Map<String, List<ClassroomDto>> buildings)
        implements ClassroomsResponse {}

    // status=occupied: {day: {building: [ClassroomScheduleDto]}}.
    @Schema(description = "Map of day -> building -> occupied slots")
    record OccupiedByDay(@JsonValue Map<String, Map<String, List<ClassroomScheduleDto>>> days)
        implements ClassroomsResponse {}
}
