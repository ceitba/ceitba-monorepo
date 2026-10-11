package org.ceitba.api.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Status;
import org.springframework.context.SmartLifecycle;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

// On shutdown the instance reports DOWN for the drain period before the
// graceful web-server shutdown (which runs in a lower phase) closes it.
class ShutdownDrainTest {

    @Test
    void reportsDownOnceStoppingAndWaitsTheDrain() {
        var drain = new ShutdownDrain(Duration.ofMillis(200));
        drain.start();
        assertThat(drain.health().getStatus()).isEqualTo(Status.UP);
        assertThat(drain.isRunning()).isTrue();

        long start = System.nanoTime();
        drain.stop();
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isGreaterThanOrEqualTo(Duration.ofMillis(200));
        assertThat(drain.health().getStatus()).isEqualTo(Status.DOWN);
        assertThat(drain.isRunning()).isFalse();
    }

    @Test
    void stopsBeforeTheGracefulWebServerShutdown() {
        // WebServerGracefulShutdownLifecycle runs at DEFAULT_PHASE - 1024; higher phases stop first.
        assertThat(new ShutdownDrain(Duration.ZERO).getPhase()).isGreaterThan(SmartLifecycle.DEFAULT_PHASE - 1024);
    }
}
