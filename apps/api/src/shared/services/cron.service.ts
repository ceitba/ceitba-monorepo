import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  @Cron('0 0,12 * * *', {
    disabled: process.env.NODE_ENV !== 'production' && process.env.ENABLE_CRON !== 'true'
  })
  handleDataUpdate() {
    this.logger.log('Running scheduled data updates...');
    // TODO: Implement UpdateCommissions and UpdateSubjects
    // UpdateCommissions();
    // UpdateSubjects();
  }
}
