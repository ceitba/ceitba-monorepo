// scheduling/EventReminderJob: hourly from 18:00 to 23:00 ART, day-before
// reminders for tomorrow's RSVP events (EventReminderService claims each event
// once). Off with EVENT_REMINDERS_ENABLED=false (tests).

import { defineJobs } from '../../jobs/scheduler';
import { EventReminderService } from './events';

export default defineJobs((deps) => {
  const reminders = new EventReminderService(deps);
  const log = deps.log.child({ component: 'EventReminderJob' });
  return [{
    name: 'EventReminderJob#run',
    lock: 'EVENT_REMINDERS',
    schedule: { cron: '0 0 18-23 * * *', zone: 'America/Argentina/Buenos_Aires' },
    enabled: deps.config.content.events.remindersEnabled,
    async run() {
      try {
        const sent = await reminders.sendDueReminders();
        if (sent > 0) log.info(`Event reminders sent for ${sent} event(s)`);
      } catch (e) {
        log.warn(`Event reminders failed: ${(e as Error).message}`);
      }
    },
  }];
});
