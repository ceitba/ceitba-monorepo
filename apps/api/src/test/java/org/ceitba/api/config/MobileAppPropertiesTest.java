package org.ceitba.api.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MobileAppPropertiesTest {

    @Test
    void defaultsWhenUnset() {
        var p = new MobileAppProperties(null, null, null);
        assertThat(p.minVersion()).isEqualTo("0.0.0");
        assertThat(p.latestVersion()).isEqualTo("0.0.0");
        assertThat(p.maintenance()).isFalse();
    }

    @Test
    void latestDefaultsToMin() {
        var p = new MobileAppProperties(" 1.3.0 ", "", false);
        assertThat(p.minVersion()).isEqualTo("1.3.0");
        assertThat(p.latestVersion()).isEqualTo("1.3.0");
    }
}
