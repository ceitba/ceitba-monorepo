import { SubjectPlan } from "@/domain/itba/models/subject-plan.model";
import { Commission } from "@/domain/itba/models/commission.model";

export interface CommissionQueryParams {
  year?: number;
  period?: "FirstSemester" | "SecondSemester";
  levels?: ("GRADUATE" | "UNDERGRADUATE")[];
}

export interface ItbaApiService {
  getSubjectsByPlan(planId: string): Promise<SubjectPlan[]>;
  getAllSubjects(): Promise<any[]>;
  getCommissions(params?: CommissionQueryParams): Promise<Commission[]>;
  getCommissionsBySubject(
    subjectCode: string,
    params?: CommissionQueryParams,
  ): Promise<Commission[]>;
}

export interface ITBACareerPlans {
  careerplan: ITBACareerplan;
}

export interface ITBACareerplan {
  name: string;
  career: string;
  degreeLevel: string;
  since: string;
  section: ITBASection[];
}

export interface ITBASection {
  name: string;
  terms?: ITBATerms;
  withoutTerm?: ITBAWithoutTerms;
}

export interface ITBATerms {
  term: ITBATerm[];
}

export interface ITBATerm {
  year: string;
  period: string;
  entries: ITBAEntries;
}

export interface ITBAEntries {
  entry: ITBASubject[];
}

export interface ITBASubject {
  type: string;
  name: string;
  code?: string;
  credits: string;
  dependencies?: ITBADependencies;
  creditsRequired?: string;
}

export interface ITBADependencies {
  dependency: any;
}

export interface ITBAWithoutTerms {
  withoutTerm: ITBASubject[];
}

export interface ITBACourseCommissions {
  courseCommissions: ITBACourseCommissionsData;
}

export interface ITBACourseCommissionsData {
  courseCommission: ITBACourseCommission[];
}

export interface ITBACourseCommission {
  subjectCode: string;
  subjectName: string;
  subjectType: string;
  courseStart: string;
  courseEnd: string;
  commissionName: string;
  commissionId: string;
  quota: string;
  enrolledStudents: string;
  courseCommissionTimes: ITBACourseCommissionTime[];
}

export interface ITBACourseCommissionTime {
  day: string;
  classRoom: string;
  building: string;
  hourFrom: string;
  hourTo: string;
}
