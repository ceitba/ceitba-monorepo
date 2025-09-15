import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import {
  DataSyncService,
  DataSyncResult,
} from "@/domain/itba/services/data-sync.service";
import { CommissionQueryParams } from "@/domain/itba/interfaces/repositories/itba-api.service.interface";
import { CronService } from "@/shared/services/cron.service";

@ApiTags("Data Sync")
@Controller("v1/admin/sync")
export class DataSyncController {
  constructor(
    private readonly dataSyncService: DataSyncService,
    private readonly cronService: CronService,
  ) {}

  @Post("all")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Manually trigger full data synchronization" })
  @ApiQuery({
    name: "year",
    required: false,
    description: "Year for commission sync (defaults to current year)",
    type: "number",
  })
  @ApiQuery({
    name: "period",
    required: false,
    enum: ["FirstSemester", "SecondSemester"],
    description: "Semester period (defaults to current period)",
  })
  @ApiQuery({
    name: "levels",
    required: false,
    description: "Comma-separated levels (GRADUATE,UNDERGRADUATE)",
    example: "GRADUATE,UNDERGRADUATE",
  })
  @ApiResponse({
    status: 200,
    description: "Data sync completed successfully",
    schema: {
      type: "object",
      properties: {
        subjects: {
          type: "object",
          properties: {
            created: { type: "number" },
            updated: { type: "number" },
            errors: { type: "number" },
          },
        },
        subjectPlans: {
          type: "object",
          properties: {
            created: { type: "number" },
            updated: { type: "number" },
            errors: { type: "number" },
          },
        },
        commissions: {
          type: "object",
          properties: {
            created: { type: "number" },
            updated: { type: "number" },
            errors: { type: "number" },
          },
        },
        totalProcessed: { type: "number" },
        duration: { type: "number" },
      },
    },
  })
  @ApiResponse({ status: 500, description: "Sync failed" })
  async syncAllData(
    @Query("year") year?: number,
    @Query("period") period?: "FirstSemester" | "SecondSemester",
    @Query("levels") levels?: string,
  ): Promise<DataSyncResult> {
    const commissionParams = this.buildCommissionParams(year, period, levels);
    return await this.dataSyncService.syncAllData({ commissionParams });
  }

  @Post("subjects")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Manually trigger subjects synchronization" })
  @ApiResponse({
    status: 200,
    description: "Subjects sync completed successfully",
  })
  @ApiResponse({ status: 500, description: "Sync failed" })
  async syncSubjects(): Promise<void> {
    return await this.cronService.updateSubjects();
  }

  @Post("commissions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Manually trigger commissions synchronization" })
  @ApiQuery({
    name: "year",
    required: false,
    description: "Year for commission sync (defaults to current year)",
    type: "number",
  })
  @ApiQuery({
    name: "period",
    required: false,
    enum: ["FirstSemester", "SecondSemester"],
    description: "Semester period (defaults to current period)",
  })
  @ApiQuery({
    name: "levels",
    required: false,
    description: "Comma-separated levels (GRADUATE,UNDERGRADUATE)",
    example: "GRADUATE,UNDERGRADUATE",
  })
  @ApiResponse({
    status: 200,
    description: "Commissions sync completed successfully",
  })
  @ApiResponse({ status: 500, description: "Sync failed" })
  async syncCommissions(
    @Query("year") year?: number,
    @Query("period") period?: "FirstSemester" | "SecondSemester",
    @Query("levels") levels?: string,
  ): Promise<void> {
    const commissionParams = this.buildCommissionParams(year, period, levels);
    const result = {
      subjects: { created: 0, updated: 0, errors: 0 },
      subjectPlans: { created: 0, updated: 0, errors: 0 },
      commissions: { created: 0, updated: 0, errors: 0 },
      totalProcessed: 0,
      duration: 0,
    };

    await this.dataSyncService.syncCommissions(result, commissionParams);
  }

  @Post("plan/:planId/subjects")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sync subjects for a specific plan" })
  @ApiParam({ name: "planId", description: "Plan ID to sync" })
  @ApiResponse({
    status: 200,
    description: "Plan subjects sync completed successfully",
  })
  @ApiResponse({ status: 500, description: "Sync failed" })
  async syncSubjectsByPlan(@Param("planId") planId: string) {
    return await this.dataSyncService.syncSubjectsByPlan(planId);
  }

  @Post("subject/:subjectCode/commissions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Sync commissions for a specific subject" })
  @ApiParam({
    name: "subjectCode",
    description: "Subject code to sync commissions for",
  })
  @ApiQuery({
    name: "year",
    required: false,
    description: "Year for commission sync (defaults to current year)",
    type: "number",
  })
  @ApiQuery({
    name: "period",
    required: false,
    enum: ["FirstSemester", "SecondSemester"],
    description: "Semester period (defaults to current period)",
  })
  @ApiQuery({
    name: "levels",
    required: false,
    description: "Comma-separated levels (GRADUATE,UNDERGRADUATE)",
    example: "GRADUATE,UNDERGRADUATE",
  })
  @ApiResponse({
    status: 200,
    description: "Subject commissions sync completed successfully",
  })
  @ApiResponse({ status: 500, description: "Sync failed" })
  async syncCommissionsBySubject(
    @Param("subjectCode") subjectCode: string,
    @Query("year") year?: number,
    @Query("period") period?: "FirstSemester" | "SecondSemester",
    @Query("levels") levels?: string,
  ) {
    const commissionParams = this.buildCommissionParams(year, period, levels);
    return await this.dataSyncService.syncCommissionsBySubject(
      subjectCode,
      commissionParams,
    );
  }

  private buildCommissionParams(
    year?: number,
    period?: "FirstSemester" | "SecondSemester",
    levels?: string,
  ): CommissionQueryParams | undefined {
    if (!year && !period && !levels) {
      return undefined; // Use defaults
    }

    const params: CommissionQueryParams = {};

    if (year) {
      params.year = year;
    }

    if (period) {
      params.period = period;
    }

    if (levels) {
      const levelArray = levels.split(",").map((l) => l.trim()) as (
        | "GRADUATE"
        | "UNDERGRADUATE"
      )[];
      // Validate levels
      const validLevels = levelArray.filter(
        (level) => level === "GRADUATE" || level === "UNDERGRADUATE",
      );
      if (validLevels.length > 0) {
        params.levels = validLevels;
      }
    }

    return params;
  }
}
