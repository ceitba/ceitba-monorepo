package org.ceitba.api.config;

import org.junit.jupiter.api.Test;
import org.springframework.context.SmartLifecycle;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

// On shutdown the instance keeps serving for the drain period before the
// graceful web-server shutdown (which runs in a lower phase) closes it.
class ShutdownDrainTest {

    @Test
    void waitsTheDrainWhenStopping() {
        var drain = new ShutdownDrain(Duration.ofMillis(200));
        drain.start();
        assertThat(drain.isRunning()).isTrue();

        long start = System.nanoTime();
        drain.stop();
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isGreaterThanOrEqualTo(Duration.ofMillis(200));
        assertThat(drain.isRunning()).isFalse();
    }

    @Test
    void stopsBeforeTheGracefulWebServerShutdown() {
        // WebServerGracefulShutdownLifecycle runs at DEFAULT_PHASE - 1024; higher phases stop first.
        assertThat(new ShutdownDrain(Duration.ZERO).getPhase()).isGreaterThan(SmartLifecycle.DEFAULT_PHASE - 1024);
    }
}
