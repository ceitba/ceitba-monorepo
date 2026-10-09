package org.ceitba.api.support;

import org.awaitility.core.ConditionTimeoutException;
import org.springframework.context.ApplicationContext;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.function.BooleanSupplier;

import static org.awaitility.Awaitility.await;

/**
 * Waits for {@code @Async} and {@code @Scheduled} work to drain: Boot's
 * {@code applicationTaskExecutor}, any other {@link ThreadPoolTaskExecutor}
 * bean, and the running tasks of any {@link ThreadPoolTaskScheduler}.
 *
 * <p>Pushes are handed to the executor from the request thread (after commit),
 * so once MockMvc returns, every push a request caused is already queued or
 * running. "Nothing more will be sent" is then exactly "the executor is idle",
 * which replaces fixed quiet periods ({@code await().during(700ms)}) that both
 * slowed every negative assertion and could miss a slow delivery.
 *
 * <p>That only holds for executors whose queue and workers can be inspected.
 * Any other {@link TaskExecutor} (e.g. the {@code SimpleAsyncTaskExecutor}
 * Boot uses with {@code spring.threads.virtual.enabled}) fails here instead of
 * letting "nothing was sent" assertions pass without waiting.
 */
public final class AsyncWork {

    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    // Idle must hold for a few polls: a worker that just took a task off the
    // queue is briefly neither queued nor counted as active.
    private static final Duration POLL = Duration.ofMillis(5);
    private static final Duration STABLE = Duration.ofMillis(15);

    private AsyncWork() {
    }

    public static void awaitIdle(ApplicationContext context) {
        awaitIdle(context, null);
    }

    /** {@code culprit}, if given, is named in the timeout message (the class that left the work behind). */
    static void awaitIdle(ApplicationContext context, String culprit) {
        if (!context.containsBean("applicationTaskExecutor")
                || !(context.getBean("applicationTaskExecutor") instanceof ThreadPoolTaskExecutor)) {
            throw new IllegalStateException("applicationTaskExecutor is not a ThreadPoolTaskExecutor, so"
                + " AsyncWork cannot tell when @Async work is done");
        }
        List<BooleanSupplier> idle = new ArrayList<>();
        context.getBeansOfType(TaskExecutor.class, false, false).forEach((name, executor) -> {
            if (executor instanceof ThreadPoolTaskScheduler scheduler) {
                // Its queue always holds the next runs of periodic jobs; only
                // a running task matters.
                var pool = scheduler.getScheduledThreadPoolExecutor();
                idle.add(() -> pool.getActiveCount() == 0);
            } else if (executor instanceof ThreadPoolTaskExecutor pooled) {
                var pool = pooled.getThreadPoolExecutor();
                idle.add(() -> pool.getActiveCount() == 0 && pool.getQueue().isEmpty());
            } else {
                throw new IllegalStateException("AsyncWork cannot tell when executor bean '" + name + "' ("
                    + executor.getClass().getName() + ") is idle");
            }
        });
        try {
            await().atMost(TIMEOUT).pollDelay(Duration.ZERO).pollInterval(POLL).during(STABLE)
                .until(() -> idle.stream().allMatch(BooleanSupplier::getAsBoolean));
        } catch (ConditionTimeoutException e) {
            throw new IllegalStateException("Async work still running after " + TIMEOUT
                + (culprit == null ? "" : ", left behind by " + culprit), e);
        }
    }
}
