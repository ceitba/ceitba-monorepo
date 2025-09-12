import { ClassroomSchedule, Classroom, TimeSlot, DayOfWeek, DayOfWeekMapper } from '@/domain/itba/models/classroom.model';
import { ClassroomRepository } from '@/domain/itba/interfaces/repositories/classroom.repository.interface';
import { ClassroomServiceInterface } from '@/domain/itba/interfaces/services/classroom.service.interface';

export class ClassroomService implements ClassroomServiceInterface {
    constructor(private readonly classroomRepository: ClassroomRepository) {}

    async getAllClassrooms(): Promise<ClassroomSchedule[]> {
        return await this.classroomRepository.findAllClassrooms();
    }

    async getOccupiedClassrooms(currentSemester?: boolean): Promise<ClassroomSchedule[]> {
        return await this.classroomRepository.findOccupiedClassrooms(currentSemester);
    }

    async getClassroomsByBuilding(building: string): Promise<ClassroomSchedule[]> {
        return await this.classroomRepository.findByBuilding(building);
    }

    async getClassroomsByDay(day: string): Promise<ClassroomSchedule[]> {
        return await this.classroomRepository.findByDay(day);
    }

    async getAvailableClassrooms(): Promise<ClassroomSchedule[]> {
        return await this.classroomRepository.findAvailableClassrooms();
    }

    async checkForConflicts(
        classroomName: string,
        building: string,
        day: string,
        hourFrom: string,
        hourTo: string
    ): Promise<ClassroomSchedule[]> {
        try {
            const classroom = new Classroom(classroomName, building);
            const timeSlot = new TimeSlot(hourFrom, hourTo);
            const dayOfWeek = DayOfWeekMapper.fromString(day);
            const schedule = new ClassroomSchedule(classroom, dayOfWeek, timeSlot);

            return await this.classroomRepository.findConflicts(schedule);
        } catch (error) {
            throw new Error(`Invalid schedule data: ${(error as Error).message}`);
        }
    }
}
