package org.ceitba.api.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.ZoneId;

// Single source of "now" for business logic. ITBA is in Buenos Aires, so
// "today" (current semester, active commissions, course dates) must be
// computed in ART regardless of the host/container timezone. Inject this
// Clock and call LocalDate.now(clock) instead of LocalDate.now(). Tests can
// override it with Clock.fixed(...).
@Configuration
public class ClockConfig {

    public static final ZoneId ZONE = ZoneId.of("America/Argentina/Buenos_Aires");

    @Bean
    public Clock clock() {
        return Clock.system(ZONE);
    }
}
