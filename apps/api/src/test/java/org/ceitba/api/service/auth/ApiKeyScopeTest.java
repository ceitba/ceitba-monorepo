package org.ceitba.api.service.auth;

import org.junit.jupiter.api.Test;

import java.util.EnumSet;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ApiKeyScopeTest {

    @Test
    void nullMeansFullPowerEmptyMeansReadOnlyAndReadIsImplied() {
        assertThat(ApiKeyScope.normalize(null)).isEqualTo(ApiKeyScope.ALL);
        assertThat(ApiKeyScope.normalize(List.of())).containsExactly(ApiKeyScope.READ);
        assertThat(ApiKeyScope.normalize(List.of(ApiKeyScope.STAFF)))
            .containsExactlyInAnyOrder(ApiKeyScope.READ, ApiKeyScope.STAFF);
    }

    @Test
    void roundTripsThroughTheColumn() {
        var s = EnumSet.of(ApiKeyScope.READ, ApiKeyScope.STAFF);
        assertThat(ApiKeyScope.serialize(s)).isEqualTo("read,staff");
        assertThat(ApiKeyScope.parse("read,staff")).isEqualTo(s);
        assertThat(ApiKeyScope.parse("read,write,staff")).isEqualTo(ApiKeyScope.ALL);
        assertThat(ApiKeyScope.parse(" WRITE ")).containsExactlyInAnyOrder(ApiKeyScope.READ, ApiKeyScope.WRITE);
    }

    @Test
    void unknownScopeIsRejected() {
        assertThatThrownBy(() -> ApiKeyScope.fromKey("admin")).isInstanceOf(IllegalArgumentException.class);
    }
}
