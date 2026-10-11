package org.ceitba.api.scheduling;

import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;

// Runs a scheduled job in one process at a time (apps/api/docs/DEPLOY.md
// "Scheduled jobs"). During a blue/green deploy two API containers run side by
// side for a while, and any other process sharing the database (a future Bun
// worker) must agree on the same ids. Each run takes the session-level
// Postgres advisory lock pg_try_advisory_lock(NAMESPACE, job.id): if another
// process holds it, the run is skipped (the next tick tries again).
//
// The lock belongs to the database session, so it is taken and released on
// one dedicated pool connection held for the whole run; the job's own queries
// and transactions use other connections. If the process dies, Postgres ends
// the session and frees the lock. If unlocking fails, the connection is
// evicted from the pool instead of being reused while still holding the lock.
@Component
public class JobLock {

    // pg_try_advisory_lock(int, int): the first int namespaces our locks
    // ("CEIT" in ASCII) away from any other advisory lock user.
    public static final int NAMESPACE = 0x43454954;

    // Stable ids, shared with any other process that runs these jobs. Never
    // reuse or renumber one.
    public enum Job {
        DATA_SYNC(1),
        EVENT_REMINDERS(2),
        MAIL_RETENTION(3),
        KB_RELATIONS(4),
        KB_EMBEDDINGS(5),
        DIGEST_SCHEDULE(6),
        DIGEST_TICK(7),
        ORG_MAIL(8),
        DRIVE_SYNC(9),
        KB_PIPELINE_BATCHES(10),
        KB_PIPELINE_POLL(11),
        KB_PIPELINE_SCHEDULE(12);

        private final int id;

        Job(int id) { this.id = id; }

        public int id() { return id; }
    }

    private static final Logger log = LoggerFactory.getLogger(JobLock.class);

    private final DataSource dataSource;

    public JobLock(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    // True if `task` ran here; false if another process holds the job's lock
    // or the database couldn't be reached to take it.
    public boolean runExclusively(Job job, Runnable task) {
        Connection conn;
        try {
            conn = dataSource.getConnection();
        } catch (SQLException e) {
            log.warn("Job {} skipped: no database connection for its lock: {}", job, e.getMessage());
            return false;
        }
        boolean locked = false;
        boolean release = true;
        try {
            locked = call(conn, "SELECT pg_try_advisory_lock(?, ?)", job);
            if (!locked) {
                log.info("Job {} skipped: another process is running it", job);
                return false;
            }
            task.run();
            return true;
        } catch (SQLException e) {
            log.warn("Job {} skipped: could not take its lock: {}", job, e.getMessage());
            return false;
        } finally {
            if (locked) {
                try {
                    release = call(conn, "SELECT pg_advisory_unlock(?, ?)", job);
                } catch (SQLException e) {
                    release = false;
                }
                if (!release) log.warn("Job {}: could not release its lock; dropping the connection", job);
            }
            close(conn, release);
        }
    }

    private static boolean call(Connection conn, String sql, Job job) throws SQLException {
        try (var st = conn.prepareStatement(sql)) {
            st.setInt(1, NAMESPACE);
            st.setInt(2, job.id());
            try (var rs = st.executeQuery()) {
                return rs.next() && rs.getBoolean(1);
            }
        }
    }

    // A connection that may still hold the lock must not go back to the pool.
    private void close(Connection conn, boolean reusable) {
        if (!reusable && dataSource instanceof HikariDataSource hikari) {
            hikari.evictConnection(conn);
            return;
        }
        try {
            conn.close();
        } catch (SQLException e) {
            log.debug("Closing a job lock connection failed: {}", e.getMessage());
        }
    }
}
