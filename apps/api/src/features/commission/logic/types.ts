// Minimal Commission shape for the pure logic (apps/api/.../domain/Commission.java).
import type { LocalDate } from '../../../lib/javaCompat';

export type SubjectType = 'ANNUAL' | 'SEMESTRAL' | 'SAMINARY';

export interface Commission {
  id: string;
  subjectCode: string;
  commissionName: string;
  courseStart: LocalDate;
  courseEnd: LocalDate;
  enrolledStudents: number;
  quota: number;
  subjectType: SubjectType;
}
