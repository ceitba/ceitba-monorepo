// web/commission/dto/CommissionResponse. Times are "HH:mm" (ART wall clock).

export interface CommissionTimeDto { day: string; hourFrom: string; hourTo: string; building: string; classroom: string }

export interface CommissionResponse {
  id: string;
  subjectCode: string;
  subjectName: string | null;
  subjectType: string;
  commissionName: string;
  quota: number;
  enrolledStudents: number;
  courseStart: string;
  courseEnd: string;
  times: CommissionTimeDto[];
}
