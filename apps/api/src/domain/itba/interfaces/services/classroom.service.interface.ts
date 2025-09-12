import { ClassroomSchedule } from '@/domain/itba/models/classroom.model';

export interface ClassroomServiceInterface {
    getAllClassrooms(): Promise<ClassroomSchedule[]>;
    getOccupiedClassrooms(currentSemester?: boolean): Promise<ClassroomSchedule[]>;
    getClassroomsByBuilding(building: string): Promise<ClassroomSchedule[]>;
    getClassroomsByDay(day: string): Promise<ClassroomSchedule[]>;
    getAvailableClassrooms(): Promise<ClassroomSchedule[]>;
    checkForConflicts(
        classroomName: string,
        building: string,
        day: string,
        hourFrom: string,
        hourTo: string
    ): Promise<ClassroomSchedule[]>;
}
