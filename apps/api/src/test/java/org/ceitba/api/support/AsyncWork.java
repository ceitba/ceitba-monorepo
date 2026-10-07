package org.ceitba.api.support;

import org.springframework.context.ApplicationContext;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.time.Duration;

/**
 * Waits for {@code @Async} work (Boot's {@code applicationTaskExecutor} and any
 * other {@link ThreadPoolTaskExecutor} bean) to drain.
 *
 * <p>Pushes are handed to the executor from the request thread (after commit),
 * so once MockMvc returns, every push a request caused is already queued or
 * running. "Nothing more will be sent" is then exactly "the executor is idle",
 * which replaces fixed quiet periods ({@code await().during(700ms)}) that both
 * slowed every negative assertion and could miss a slow delivery.
 */
public final class AsyncWork {

    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    // Idle must hold for a few consecutive polls: a worker that just took a
    // task off the queue is briefly neither queued nor counted as active.
    private static final int STABLE_POLLS = 3;

    private AsyncWork() {
    }

    public static void awaitIdle(ApplicationContext context) {
        long deadline = System.nanoTime() + TIMEOUT.toNanos();
        for (var executor : context.getBeansOfType(ThreadPoolTaskExecutor.class, false, false).values()) {
            var pool = executor.getThreadPoolExecutor();
            int stable = 0;
            while (stable < STABLE_POLLS) {
                boolean idle = pool.getActiveCount() == 0 && pool.getQueue().isEmpty();
                stable = idle ? stable + 1 : 0;
                if (System.nanoTime() > deadline) {
                    throw new IllegalStateException("Async work still running on "
                        + executor.getThreadNamePrefix() + "* after " + TIMEOUT);
                }
                try {
                    Thread.sleep(5);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(e);
                }
            }
        }
    }
}
