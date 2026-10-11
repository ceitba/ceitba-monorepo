package org.ceitba.api.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

import java.time.Duration;

// Blue/green drain (apps/api/docs/DEPLOY.md). When a deploy stops this
// instance, it first reports DOWN on /actuator/health (component
// "shutdownDrain") and keeps serving for `shutdown.drain` (prod: 5s, more than
// Caddy's health_interval + health_timeout), so Caddy moves traffic to the
// other color before the graceful shutdown closes the connector. Without it,
// requests that reach the instance in that window wait for Caddy's next health
// check.
//
// Stops in the highest lifecycle phase, i.e. before WebServerGracefulShutdown
// (DEFAULT_PHASE - 1024). Zero (the default, and in tests) skips the wait.
@Component
public class ShutdownDrain implements SmartLifecycle, HealthIndicator {

    private static final Logger log = LoggerFactory.getLogger(ShutdownDrain.class);

    private final Duration drain;
    private volatile boolean running;
    private volatile boolean draining;

    public ShutdownDrain(@Value("${shutdown.drain:PT0S}") Duration drain) {
        this.drain = drain;
    }

    @Override
    public Health health() {
        return draining ? Health.down().withDetail("draining", true).build() : Health.up().build();
    }

    @Override
    public void start() {
        running = true;
    }

    @Override
    public void stop() {
        draining = true;
        if (!drain.isZero() && !drain.isNegative()) {
            log.info("Shutting down: reporting DOWN and draining for {}s", drain.toSeconds());
            try {
                Thread.sleep(drain.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        running = false;
    }

    @Override
    public boolean isRunning() {
        return running;
    }

    @Override
    public int getPhase() {
        return Integer.MAX_VALUE;
    }
}
