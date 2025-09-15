import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSyncService } from "@/domain/itba/services/data-sync.service";

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(private readonly dataSyncService: DataSyncService) {}

  @Cron("0 0,12 * * *", {
    disabled:
      process.env.NODE_ENV !== "production" &&
      process.env.ENABLE_CRON !== "true",
  })
  async handleDataUpdate() {
    this.logger.log("Running scheduled data updates...");

    try {
      const result = await this.dataSyncService.syncAllData();

      this.logger.log(`Data sync completed successfully:`, {
        subjects: result.subjects,
        subjectPlans: result.subjectPlans,
        commissions: result.commissions,
        duration: `${result.duration}ms`,
        totalProcessed: result.totalProcessed,
      });
    } catch (error) {
      this.logger.error("Scheduled data update failed:", error);
    }
  }

  async updateCommissions() {
    this.logger.log("Running commission updates...");

    try {
      const result = {
        subjects: { created: 0, updated: 0, errors: 0 },
        subjectPlans: { created: 0, updated: 0, errors: 0 },
        commissions: { created: 0, updated: 0, errors: 0 },
        totalProcessed: 0,
        duration: 0,
      };

      await this.dataSyncService.syncCommissions(result);

      this.logger.log("Commission updates completed successfully:", {
        commissions: result.commissions,
      });
    } catch (error) {
      this.logger.error("Commission update failed:", error);
      throw error;
    }
  }

  async updateSubjects() {
    this.logger.log("Running subject updates...");

    try {
      const result = {
        subjects: { created: 0, updated: 0, errors: 0 },
        subjectPlans: { created: 0, updated: 0, errors: 0 },
        commissions: { created: 0, updated: 0, errors: 0 },
        totalProcessed: 0,
        duration: 0,
      };

      await this.dataSyncService.syncSubjectsAndPlans(result);

      this.logger.log("Subject updates completed successfully:", {
        subjects: result.subjects,
        subjectPlans: result.subjectPlans,
      });
    } catch (error) {
      this.logger.error("Subject update failed:", error);
      throw error;
    }
  }
}
