package org.ceitba.api.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

import java.time.Duration;

// Blue/green drain (apps/api/docs/DEPLOY.md). When the context closes, Spring
// Boot first switches the readiness state to REFUSING_TRAFFIC, so
// /actuator/health/readiness (Caddy's health check) answers 503. This bean,
// stopped in the highest lifecycle phase (before the web server's graceful
// shutdown at DEFAULT_PHASE - 1024), then keeps the instance serving for
// `shutdown.drain` (prod: 5s, more than Caddy's health_interval +
// health_timeout), so Caddy has moved traffic to the other color before the
// connector closes. Zero (the default, and in tests) skips the wait.
@Component
public class ShutdownDrain implements SmartLifecycle {

    private static final Logger log = LoggerFactory.getLogger(ShutdownDrain.class);

    private final Duration drain;
    private volatile boolean running;

    public ShutdownDrain(@Value("${shutdown.drain:PT0S}") Duration drain) {
        this.drain = drain;
    }

    @Override
    public void start() {
        running = true;
    }

    @Override
    public void stop() {
        if (!drain.isZero() && !drain.isNegative()) {
            log.info("Shutting down: refusing traffic and draining for {}s", drain.toSeconds());
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
