import { ClassroomSchedule } from '@/domain/itba/models/classroom.model';

export interface ClassroomServiceInterface {
    getAllClassrooms(): Promise<ClassroomSchedule[]>;
    getClassroomsWithFilters(filters: {
        status?: 'occupied' | 'available'; // TODO: Make this a type
        current_semester?: boolean;
    }): Promise<ClassroomSchedule[]>;
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
