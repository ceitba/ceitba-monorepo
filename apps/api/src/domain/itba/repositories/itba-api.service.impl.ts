import { SubjectPlan } from "@/domain/itba/models/subject-plan.model";
import { Subject } from "@/domain/itba/models/subject.model";
import {
  Commission,
  CommissionTime,
  SubjectType,
  DayOfWeek,
} from "@/domain/itba/models/commission.model";
import {
  ItbaApiService,
  CommissionQueryParams,
  ITBACareerPlans,
  ITBASection,
  ITBASubject,
  ITBACourseCommissions,
  ITBACourseCommission,
  ITBACourseCommissionTime,
} from "@/domain/itba/interfaces/repositories/itba-api.service.interface";
import { ApiClient, ApiFactory } from "@/shared/external-apis";
import { ExternalApiConfig } from "@/shared/external-apis/api-client.interface";

export class ItbaApiServiceImpl implements ItbaApiService {
  private readonly apiClient: ApiClient;
  private readonly apiToken: string;

  constructor(
    apiToken: string,
    apiConfig?: ExternalApiConfig,
    apiClient?: ApiClient,
  ) {
    this.apiToken = apiToken;
    this.apiClient = apiClient!;
  }

  async getSubjectsByPlan(planId: string): Promise<SubjectPlan[]> {
    const subjectPlans: SubjectPlan[] = [];

    try {
      const response = await this.apiClient.get<ITBACareerPlans>(
        `/careerPlans/${this.apiToken}`,
        {
          params: { plan: planId },
        },
      );

      if (response.error) {
        throw new Error(`API Error: ${response.error.message}`);
      }

      if (!response.data) {
        throw new Error("No data received from ITBA API");
      }

      const jsonData = response.data;

      jsonData.careerplan.section = Array.isArray(jsonData.careerplan.section)
        ? jsonData.careerplan.section
        : [jsonData.careerplan.section];

      jsonData.careerplan.section.forEach((jsonSection) => {
        this.processSection(jsonSection, planId, subjectPlans);
      });

      return subjectPlans;
    } catch (error) {
      throw new Error(
        `Error fetching data from ITBA API for planId: ${planId} - ${(error as Error).message}`,
      );
    }
  }

  async getAllSubjects(): Promise<any[]> {
    return [];
  }

  async getCommissions(params?: CommissionQueryParams): Promise<Commission[]> {
    const queryParams = this.getDefaultCommissionParams(params);
    const commissions: Commission[] = [];

    try {
      for (const level of queryParams.levels) {
        const response = await this.apiClient.get<ITBACourseCommissions>(
          `/courseCommissions/${this.apiToken}`,
          {
            params: {
              level: level,
              year: queryParams.year.toString(),
              period: queryParams.period,
            },
          },
        );

        if (response.error) {
          console.warn(
            `API Error for level ${level}: ${response.error.message}`,
          );
          continue;
        }

        if (!response.data || !response.data.courseCommissions) {
          console.warn(`No commission data received for level ${level}`);
          continue;
        }

        const courseCommissions = Array.isArray(
          response.data.courseCommissions.courseCommission,
        )
          ? response.data.courseCommissions.courseCommission
          : [response.data.courseCommissions.courseCommission];

        for (const course of courseCommissions) {
          if (!course || !course.courseCommissionTimes) {
            console.warn(
              `Skipping course without times: ${course?.subjectName}`,
            );
            continue;
          }

          // Skip certain subjects (ITBA)
          if (
            course.subjectCode === "99.52" ||
            course.subjectCode === "99.56"
          ) {
            continue;
          }

          const commission = this.mapToCourseCommission(course);
          commissions.push(commission);
        }
      }

      return commissions;
    } catch (error) {
      throw new Error(
        `Error fetching commissions from ITBA API - ${(error as Error).message}`,
      );
    }
  }

  async getCommissionsBySubject(
    subjectCode: string,
    params?: CommissionQueryParams,
  ): Promise<Commission[]> {
    const allCommissions = await this.getCommissions(params);
    return allCommissions.filter(
      (commission) => commission.subjectCode === subjectCode,
    );
  }

  private getDefaultCommissionParams(
    params?: CommissionQueryParams,
  ): Required<CommissionQueryParams> {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // JavaScript months are 0-indexed

    const defaultPeriod =
      currentMonth >= 2 && currentMonth <= 6
        ? "FirstSemester"
        : "SecondSemester";

    return {
      year: params?.year ?? currentYear,
      period: params?.period ?? defaultPeriod,
      levels: params?.levels ?? ["GRADUATE", "UNDERGRADUATE"],
    };
  }

  private processSection(
    jsonSection: ITBASection,
    planId: string,
    subjectPlans: SubjectPlan[],
  ): void {
    if (jsonSection.terms) {
      const terms = Array.isArray(jsonSection.terms.term)
        ? jsonSection.terms.term
        : [jsonSection.terms.term];

      terms.forEach((jsonPeriod) => {
        if (jsonPeriod.entries) {
          const entries = Array.isArray(jsonPeriod.entries.entry)
            ? jsonPeriod.entries.entry
            : [jsonPeriod.entries.entry];

          entries.forEach((jsonSubject) => {
            if (jsonSubject.type === "subject") {
              const subjectPlan = this.createSubjectPlan(
                jsonSubject,
                planId,
                jsonSection.name,
                parseInt(jsonPeriod.year),
                parseInt(jsonPeriod.period),
              );
              subjectPlans.push(subjectPlan);
            }
          });
        }
      });
    } else if (jsonSection.withoutTerm) {
      const withoutTermSubjects = Array.isArray(
        jsonSection.withoutTerm.withoutTerm,
      )
        ? jsonSection.withoutTerm.withoutTerm
        : [jsonSection.withoutTerm.withoutTerm];

      withoutTermSubjects.forEach((jsonSubject) => {
        if (jsonSubject.type === "subject") {
          const subjectPlan = this.createSubjectPlan(
            jsonSubject,
            planId,
            jsonSection.name,
            null,
            null,
          );
          subjectPlans.push(subjectPlan);
        }
      });
    }
  }

  private createSubjectPlan(
    jsonSubject: ITBASubject,
    planId: string,
    section: string,
    year: number | null,
    semester: number | null,
  ): SubjectPlan {
    const dependencies = this.extractDependencies(jsonSubject);
    const creditsRequired = jsonSubject.creditsRequired
      ? parseInt(jsonSubject.creditsRequired)
      : null;

    const subject = new Subject(
      jsonSubject.code!,
      jsonSubject.name,
      parseInt(jsonSubject.credits),
    );

    return new SubjectPlan(
      jsonSubject.code!,
      planId,
      section,
      year,
      semester,
      dependencies,
      creditsRequired,
      subject,
    );
  }

  private extractDependencies(jsonSubject: ITBASubject): string[] {
    if (!jsonSubject.dependencies?.dependency) {
      return [];
    }

    if (Array.isArray(jsonSubject.dependencies.dependency)) {
      return jsonSubject.dependencies.dependency;
    } else {
      return [jsonSubject.dependencies.dependency];
    }
  }

  private mapToCourseCommission(courseData: ITBACourseCommission): Commission {
    const courseStart = this.parseDate(courseData.courseStart);
    const courseEnd = this.parseDate(courseData.courseEnd);

    const times = this.mapCommissionTimes(courseData);

    return new Commission(
      courseData.commissionId,
      courseData.subjectCode,
      courseData.commissionName,
      courseStart,
      courseEnd,
      parseInt(courseData.enrolledStudents),
      parseInt(courseData.quota),
      this.mapSubjectType(courseData.subjectType),
      times,
    );
  }

  private mapCommissionTimes(
    courseData: ITBACourseCommission,
  ): CommissionTime[] {
    if (!courseData.courseCommissionTimes) {
      return [];
    }

    const times = Array.isArray(courseData.courseCommissionTimes)
      ? courseData.courseCommissionTimes
      : [courseData.courseCommissionTimes];

    const mappedTimes = times
      .filter((time) => time != undefined)
      .map((time) => {
        // Normalize building names as per original logic
        let building = time.building;
        switch (building) {
          case "External":
            building = "Online";
            break;
          case "Sede Distrito Financiero":
            building = "SDF";
            break;
          case "Sede Rectorado":
            building = "SDR";
            break;
        }

        const classroom = time.classRoom || "Virtual Asincrónico";

        return new CommissionTime(
          courseData.commissionId,
          this.mapDayOfWeek(time.day),
          classroom,
          building,
          this.parseTime(time.hourFrom),
          this.parseTime(time.hourTo),
        );
      });

    const uniqueTimes = new Map<string, CommissionTime>();
    mappedTimes.forEach((time) => {
      const key = `${time.courseId}-${time.day}-${time.hourFrom.getTime()}`;
      if (!uniqueTimes.has(key)) {
        uniqueTimes.set(key, time);
      }
    });

    return Array.from(uniqueTimes.values());
  }

  private parseDate(dateString: string): Date {
    // Parse date in format 'dd/MM/yy'
    const [day, month, year] = dateString.split("/");
    const fullYear = parseInt("20" + year); // Assuming 2000s
    return new Date(fullYear, parseInt(month) - 1, parseInt(day));
  }

  private parseTime(timeString: string): Date {
    // Create a date with a fixed epoch date (1970-01-01) and just the time component
    // This ensures consistent time-only values for PostgreSQL TIME fields
    const [hours, minutes] = timeString.split(":");
    const date = new Date(1970, 0, 1); // January 1, 1970
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    return date;
  }

  private mapDayOfWeek(day: string): DayOfWeek {
    const dayMap: Record<string, DayOfWeek> = {
      MONDAY: DayOfWeek.MONDAY,
      TUESDAY: DayOfWeek.TUESDAY,
      WEDNESDAY: DayOfWeek.WEDNESDAY,
      THURSDAY: DayOfWeek.THURSDAY,
      FRIDAY: DayOfWeek.FRIDAY,
      SATURDAY: DayOfWeek.SATURDAY,
      SUNDAY: DayOfWeek.SUNDAY,
    };
    return dayMap[day.toUpperCase()] || DayOfWeek.MONDAY;
  }

  private mapSubjectType(type: string): SubjectType {
    const typeMap: Record<string, SubjectType> = {
      ANNUAL: SubjectType.ANNUAL,
      SEMESTRAL: SubjectType.SEMESTRAL,
      SAMINARY: SubjectType.SAMINARY,
    };
    return typeMap[type.toUpperCase()] || SubjectType.SEMESTRAL;
  }
}
