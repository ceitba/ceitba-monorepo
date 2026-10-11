package org.ceitba.api.scheduling;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.jdbc.JdbcConnectionDetails;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Properties;

// Runs each scheduled job once, in one process (apps/api/docs/DEPLOY.md
// "Scheduled jobs"). During a blue/green deploy two API containers run side by
// side and both fire every tick; any other process sharing the database (a
// future Bun worker) must use the same ids.
//
// A run first takes the session-level advisory lock
// pg_try_advisory_lock(NAMESPACE, job.id), so runs never overlap, then, under
// that lock, claims the job's public.scheduled_job_run row: if another run
// started less than MIN_GAP ago (the other color firing the same cron tick,
// even if it already finished) this one is skipped. Either way a skip is
// logged and the next tick tries again.
//
// The lock lives on a dedicated JDBC connection opened for the run, outside
// the Hikari pool (so long jobs don't pin pool connections web requests need).
// Closing it ends the session and frees the lock, also if the process dies.
@Component
public class JobLock {

    // pg_try_advisory_lock(int, int): the first int namespaces our locks
    // ("CEIT" in ASCII) away from any other advisory lock user.
    public static final int NAMESPACE = 0x43454954;

    // Two runs of a job closer than this are the same tick seen by two
    // processes. Shorter than every job's period (the shortest is 1 minute).
    static final Duration MIN_GAP = Duration.ofSeconds(30);

    // Stable ids, shared with any other process that runs these jobs. Never
    // reuse or renumber one. `method` is the @Scheduled method it guards
    // (JobLockCoverageTest checks that every @Scheduled method has one).
    public enum Job {
        DATA_SYNC(1, "DataSyncJob#run"),
        EVENT_REMINDERS(2, "EventReminderJob#run"),
        MAIL_RETENTION(3, "MailRetentionJob#run"),
        KB_RELATIONS(4, "KbRelationJob#run"),
        KB_EMBEDDINGS(5, "KbEmbeddingJob#run"),
        DIGEST_SCHEDULE(6, "DigestJob#createWeeklyDraft"),
        DIGEST_TICK(7, "DigestJob#tick"),
        // 8 is reserved (was ORG_MAIL): OrgMailJob.tick only hands work to the
        // executor; the sender's delivery claims (FOR UPDATE SKIP LOCKED) are
        // what keeps two processes from sending the same email.
        DRIVE_SYNC(9, "DriveSyncJob#run"),
        KB_PIPELINE_BATCHES(10, "KbPipelineJob#pollBatches"),
        KB_PIPELINE_POLL(11, "KbPipelineJob#sweep"),
        KB_PIPELINE_SCHEDULE(12, "KbPipelineJob#tick");

        private final int id;
        private final String method;

        Job(int id, String method) {
            this.id = id;
            this.method = method;
        }

        public int id() { return id; }

        public String method() { return method; }
    }

    private static final Logger log = LoggerFactory.getLogger(JobLock.class);

    private static final String CLAIM = """
        INSERT INTO public.scheduled_job_run (job_id, job_name, last_started_at) VALUES (?, ?, now())
        ON CONFLICT (job_id) DO UPDATE
            SET job_name = EXCLUDED.job_name, last_started_at = EXCLUDED.last_started_at
            WHERE public.scheduled_job_run.last_started_at < now() - make_interval(secs => ?)
        """;

    private final JdbcConnectionDetails db;

    public JobLock(JdbcConnectionDetails db) {
        this.db = db;
    }

    // True if `task` ran here; false if another process is running the job,
    // started it moments ago, or the database couldn't be reached.
    public boolean runExclusively(Job job, Runnable task) {
        try (Connection conn = connect()) {
            if (!call(conn, "SELECT pg_try_advisory_lock(?, ?)", job)) {
                log.info("Job {} skipped: another process is running it", job);
                return false;
            }
            try {
                if (!claim(conn, job)) {
                    log.info("Job {} skipped: another process started it less than {}s ago", job,
                        MIN_GAP.toSeconds());
                    return false;
                }
                task.run();
                return true;
            } finally {
                try {
                    call(conn, "SELECT pg_advisory_unlock(?, ?)", job);
                } catch (SQLException e) {
                    // Closing the connection below ends the session, which frees it anyway.
                    log.debug("Job {}: unlock failed, closing the session instead: {}", job, e.getMessage());
                }
            }
        } catch (SQLException e) {
            log.warn("Job {} skipped: could not take its lock: {}", job, e.getMessage());
            return false;
        }
    }

    private Connection connect() throws SQLException {
        var props = new Properties();
        if (db.getUsername() != null) props.setProperty("user", db.getUsername());
        if (db.getPassword() != null) props.setProperty("password", db.getPassword());
        props.setProperty("ApplicationName", "ceitba-api job lock");
        props.setProperty("connectTimeout", "10");
        return DriverManager.getConnection(db.getJdbcUrl(), props);
    }

    private static boolean claim(Connection conn, Job job) throws SQLException {
        try (var st = conn.prepareStatement(CLAIM)) {
            st.setInt(1, job.id());
            st.setString(2, job.name());
            st.setLong(3, MIN_GAP.toSeconds());
            return st.executeUpdate() == 1;
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
}
