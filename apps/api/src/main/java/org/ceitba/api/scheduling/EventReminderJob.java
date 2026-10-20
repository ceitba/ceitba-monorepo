package org.ceitba.api.scheduling;

import org.ceitba.api.service.news.EventReminderService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

// Hourly from 18:00 to 23:00 ART: day-before reminders for tomorrow's RSVP
// events (EventReminderService claims each event once, so the later runs
// only catch what a restart missed). Off with events.reminders-enabled=false
// (tests).
@Component
@ConditionalOnProperty(name = "events.reminders-enabled", havingValue = "true", matchIfMissing = true)
public class EventReminderJob {

    private static final Logger log = LoggerFactory.getLogger(EventReminderJob.class);

    private final EventReminderService reminders;
    private final JobLock jobLock;

    public EventReminderJob(EventReminderService reminders, JobLock jobLock) {
        this.reminders = reminders;
        this.jobLock = jobLock;
    }

    @Scheduled(cron = "0 0 18-23 * * *", zone = "America/Argentina/Buenos_Aires")
    public void run() {
        jobLock.runExclusively(JobLock.Job.EVENT_REMINDERS, () -> {
            try {
                int sent = reminders.sendDueReminders();
                if (sent > 0) log.info("Event reminders sent for {} event(s)", sent);
            } catch (RuntimeException e) {
                log.warn("Event reminders failed: {}", e.getMessage());
            }
        });
    }
}
