package org.ceitba.api.scheduling;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// A scheduled job runs once, in one process: while another session (the other
// blue/green color, or a Bun worker) holds the job's advisory lock the run is
// skipped; a run that starts moments after another one (the same cron tick
// seen by both colors) is skipped too; the lock is free after a run, even if
// the task threw, and the job's own queries never wait on the lock's session.
@SpringBootTest
class JobLockIT {

    @Autowired JobLock jobLock;
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void forgetPreviousRuns() {
        jdbc.update("DELETE FROM public.scheduled_job_run");
    }

    @Test
    void skipsWhileAnotherSessionHoldsTheLock() throws Exception {
        var runs = new AtomicInteger();
        try (Connection other = dataSource.getConnection()) {
            assertThat(lock(other, "pg_try_advisory_lock", JobLock.Job.DATA_SYNC)).isTrue();

            assertThat(jobLock.runExclusively(JobLock.Job.DATA_SYNC, runs::incrementAndGet)).isFalse();
            assertThat(runs).hasValue(0);
            // Other jobs are not blocked.
            assertThat(jobLock.runExclusively(JobLock.Job.MAIL_RETENTION, runs::incrementAndGet)).isTrue();
            assertThat(runs).hasValue(1);

            assertThat(lock(other, "pg_advisory_unlock", JobLock.Job.DATA_SYNC)).isTrue();
        }
        assertThat(jobLock.runExclusively(JobLock.Job.DATA_SYNC, runs::incrementAndGet)).isTrue();
        assertThat(runs).hasValue(2);
    }

    @Test
    void skipsTheSameTickSeenByAnotherProcessAfterItFinished() {
        var runs = new AtomicInteger();
        assertThat(jobLock.runExclusively(JobLock.Job.KB_RELATIONS, runs::incrementAndGet)).isTrue();
        // The other color fires the same cron tick a moment later: the lock is free, the claim is not.
        assertThat(jobLock.runExclusively(JobLock.Job.KB_RELATIONS, runs::incrementAndGet)).isFalse();
        assertThat(runs).hasValue(1);

        // Once the last start is older than MIN_GAP, the next tick runs.
        jdbc.update("UPDATE public.scheduled_job_run SET last_started_at = now() - interval '31 seconds' WHERE job_id = ?",
            JobLock.Job.KB_RELATIONS.id());
        assertThat(jobLock.runExclusively(JobLock.Job.KB_RELATIONS, runs::incrementAndGet)).isTrue();
        assertThat(runs).hasValue(2);
        assertThat(jdbc.queryForObject("SELECT job_name FROM public.scheduled_job_run WHERE job_id = ?",
            String.class, JobLock.Job.KB_RELATIONS.id())).isEqualTo("KB_RELATIONS");
    }

    @Test
    void releasesTheLockAfterARunEvenWhenTheTaskThrows() {
        jobLock.runExclusively(JobLock.Job.EVENT_REMINDERS, () -> {
            // While running, the lock is held, and the task's own queries (pool connections) go through.
            assertThat(heldLocks(JobLock.Job.EVENT_REMINDERS)).isEqualTo(1);
        });
        assertThat(heldLocks(JobLock.Job.EVENT_REMINDERS)).isZero();

        forgetPreviousRuns();
        assertThatThrownBy(() -> jobLock.runExclusively(JobLock.Job.EVENT_REMINDERS, () -> {
            throw new IllegalStateException("boom");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(heldLocks(JobLock.Job.EVENT_REMINDERS)).isZero();
    }

    private int heldLocks(JobLock.Job job) {
        return jdbc.queryForObject("""
            SELECT count(*) FROM pg_locks
            WHERE locktype = 'advisory' AND granted AND classid = ? AND objid = ? AND objsubid = 2
            """, Integer.class, JobLock.NAMESPACE, job.id());
    }

    private static boolean lock(Connection conn, String fn, JobLock.Job job) throws Exception {
        try (var st = conn.prepareStatement("SELECT " + fn + "(?, ?)")) {
            st.setInt(1, JobLock.NAMESPACE);
            st.setInt(2, job.id());
            try (var rs = st.executeQuery()) {
                rs.next();
                return rs.getBoolean(1);
            }
        }
    }
}
