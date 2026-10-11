package org.ceitba.api.scheduling;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

// A scheduled job runs in one process at a time: while another session (the
// other blue/green color, or a Bun worker) holds the job's advisory lock, the
// run is skipped; after a run the lock is free again, even if the task threw.
@SpringBootTest
class JobLockIT {

    @Autowired JobLock jobLock;
    @Autowired DataSource dataSource;
    @Autowired JdbcTemplate jdbc;

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
    void releasesTheLockAfterARunEvenWhenTheTaskThrows() {
        jobLock.runExclusively(JobLock.Job.EVENT_REMINDERS, () -> {
            // While running, the lock is held: no other session can take it.
            assertThat(heldLocks(JobLock.Job.EVENT_REMINDERS)).isEqualTo(1);
        });
        assertThat(heldLocks(JobLock.Job.EVENT_REMINDERS)).isZero();

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
