package org.ceitba.api.service.user;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

// payload_updated_at (digest staleness) must move only on a real change.
class SavedSchedulePayloadChangeTest {

    @Test
    void sameContentIsNotAChangeEvenWithDifferentKeyOrderOrNumberTypes() {
        var stored = new LinkedHashMap<String, Object>();
        stored.put("version", 1);
        stored.put("selectedCourses", List.of(Map.of("subjectCode", "61.03")));
        var incoming = new LinkedHashMap<String, Object>();
        incoming.put("selectedCourses", List.of(Map.of("subjectCode", "61.03")));
        incoming.put("version", 1L);

        assertThat(SavedScheduleService.payloadChanged(stored, incoming)).isFalse();
        assertThat(SavedScheduleService.payloadChanged(null, Map.of())).isFalse();
    }

    @Test
    void differentContentIsAChange() {
        var stored = Map.<String, Object>of("selectedCourses", List.of(Map.of("subjectCode", "61.03")));
        var incoming = Map.<String, Object>of("selectedCourses", List.of(Map.of("subjectCode", "61.04")));
        assertThat(SavedScheduleService.payloadChanged(stored, incoming)).isTrue();
    }
}
