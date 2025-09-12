import { ClassroomSchedule } from '@/domain/itba/models/classroom.model';

export interface ClassroomRepository {
    findAllClassrooms(): Promise<ClassroomSchedule[]>;
    findOccupiedClassrooms(currentSemester?: boolean): Promise<ClassroomSchedule[]>;
    findByBuilding(building: string): Promise<ClassroomSchedule[]>;
    findByDay(day: string): Promise<ClassroomSchedule[]>;
    findAvailableClassrooms(): Promise<ClassroomSchedule[]>;
    findConflicts(schedule: ClassroomSchedule): Promise<ClassroomSchedule[]>;
}
