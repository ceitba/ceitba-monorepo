package org.ceitba.api.service.kb.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.ceitba.api.common.exception.ValidationException;
import org.ceitba.api.config.KbLlmProperties;
import org.ceitba.api.config.KbPipelineProperties;
import org.junit.jupiter.api.Test;

import java.time.Clock;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// Wrongly typed values are refused (not read as 0/false), read-only fields of
// the echoed response are ignored, and resending a default stores nothing.
class KbSettingsValidationTest {

    final ObjectMapper json = new ObjectMapper();
    final KbSettingsService service = new KbSettingsService(null, null, null,
        new KbPipelineProperties(false, null, null, null, null, null, null, null, null, null, null, null, null, null),
        new KbLlmProperties(null, null, "sync", null, false), null, json, Clock.systemUTC(), null);

    @Test
    void wrongTypesNameTheField() throws Exception {
        assertThatThrownBy(() -> KbSettingsService.checkTypes(json.readTree("{\"weeklyCostLimitUsd\":\"25\"}")))
            .isInstanceOf(ValidationException.class).hasMessageContaining("weeklyCostLimitUsd");
        assertThatThrownBy(() -> KbSettingsService.checkTypes(json.readTree("{\"enabled\":\"yes\"}")))
            .isInstanceOf(ValidationException.class).hasMessageContaining("enabled");
        KbSettingsService.checkTypes(json.readTree("{\"weeklyCostLimitUsd\":25,\"enabled\":true,\"cron\":null}"));
    }

    @Test
    void defaultsAndReadOnlyFieldsAreNotStored() throws Exception {
        var body = json.readTree("""
            {"enabled":false,"cron":"0 0 3 * * SUN","runTokenBudget":3000000,"modelWrite":"glm-5.3",
             "weeklyCostLimitUsd":25,"costImpact":{"previous":null},"source":{},"updatedAt":"2026-10-01T00:00:00Z"}""");
        var next = service.applied(json.createObjectNode(), body);
        assertThat(next.toString()).isEqualTo("{\"weeklyCostLimitUsd\":25}");
    }

    // A stored (or env) budget of 5 trillion is used as at most the ceiling.
    @Test
    void runTokenBudgetIsClampedWhenUsed() throws Exception {
        assertThat(service.merge(json.readTree("{\"runTokenBudget\":5000000000000}")).runTokenBudget())
            .isEqualTo(KbPipelineProperties.DEFAULT_TOKEN_BUDGET_MAX);
        assertThat(service.merge(json.readTree("{\"runTokenBudget\":1000}")).runTokenBudget()).isEqualTo(1000);
    }
}
