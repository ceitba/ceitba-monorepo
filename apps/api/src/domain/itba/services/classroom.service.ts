import { ClassroomSchedule, Classroom, TimeSlot, DayOfWeek } from '../models/classroom.model';
import { ClassroomRepository } from '../interfaces/classroom.repository.interface';
import { 
    ClassroomDto, 
    ClassroomScheduleDto, 
    ClassroomsByBuildingDto, 
    ClassroomsByDayAndBuildingDto 
} from '../dto/classroom.dto';

export class ClassroomService {
    constructor(private readonly classroomRepository: ClassroomRepository) {}

    async getAllClassrooms(): Promise<ClassroomsByBuildingDto> {
        const classrooms = await this.classroomRepository.findAllClassrooms();
        return this.groupClassroomsByBuilding(classrooms);
    }

    async getOccupiedClassrooms(currentSemester?: boolean): Promise<ClassroomsByDayAndBuildingDto> {
        const occupiedClassrooms = await this.classroomRepository.findOccupiedClassrooms(currentSemester);
        return this.groupClassroomsByDayAndBuilding(occupiedClassrooms);
    }

    async getClassroomsByBuilding(building: string): Promise<ClassroomDto[]> {
        const classrooms = await this.classroomRepository.findByBuilding(building);
        return classrooms.map(this.mapToClassroomDto);
    }

    async getClassroomsByDay(day: string): Promise<ClassroomScheduleDto[]> {
        const classrooms = await this.classroomRepository.findByDay(day);
        return classrooms.map(this.mapToScheduleDto);
    }

    async getAvailableClassrooms(): Promise<ClassroomsByBuildingDto> {
        const availableClassrooms = await this.classroomRepository.findAvailableClassrooms();
        return this.groupClassroomsByBuilding(availableClassrooms);
    }

    async checkForConflicts(
        classroomName: string,
        building: string,
        day: string,
        hourFrom: string,
        hourTo: string
    ): Promise<ClassroomScheduleDto[]> {
        try {
            const classroom = new Classroom(classroomName, building);
            const timeSlot = new TimeSlot(hourFrom, hourTo);
            const dayOfWeek = this.mapStringToDayOfWeek(day);
            const schedule = new ClassroomSchedule(classroom, dayOfWeek, timeSlot);

            const conflicts = await this.classroomRepository.findConflicts(schedule);
            return conflicts.map(this.mapToScheduleDto);
        } catch (error) {
            throw new Error(`Invalid schedule data: ${(error as Error).message}`);
        }
    }

    private groupClassroomsByBuilding(classrooms: ClassroomSchedule[]): ClassroomsByBuildingDto {
        const result: ClassroomsByBuildingDto = {};

        for (const schedule of classrooms) {
            const building = schedule.classroom.building;
            
            // Skip online classrooms
            if (schedule.classroom.isOnline()) {
                continue;
            }

            if (!result[building]) {
                result[building] = [];
            }

            result[building].push(this.mapToClassroomDto(schedule));
        }

        return result;
    }

    private groupClassroomsByDayAndBuilding(classrooms: ClassroomSchedule[]): ClassroomsByDayAndBuildingDto {
        const result: ClassroomsByDayAndBuildingDto = {};

        for (const schedule of classrooms) {
            if (!schedule.day || !schedule.isOccupied()) {
                continue;
            }

            const day = schedule.day;
            const building = schedule.classroom.building;

            // Skip online classrooms
            if (schedule.classroom.isOnline()) {
                continue;
            }

            if (!result[day]) {
                result[day] = {};
            }

            if (!result[day][building]) {
                result[day][building] = [];
            }

            result[day][building].push(this.mapToScheduleDto(schedule));
        }

        return result;
    }

    private mapToClassroomDto(schedule: ClassroomSchedule): ClassroomDto {
        return {
            name: schedule.classroom.name,
            building: schedule.classroom.building,
            day: schedule.day,
            hourFrom: schedule.timeSlot?.hourFrom ?? null,
            hourTo: schedule.timeSlot?.hourTo ?? null
        };
    }

    private mapToScheduleDto(schedule: ClassroomSchedule): ClassroomScheduleDto {
        return {
            classroom: schedule.classroom.name,
            building: schedule.classroom.building,
            day: schedule.day,
            hourFrom: schedule.timeSlot?.hourFrom ?? null,
            hourTo: schedule.timeSlot?.hourTo ?? null
        };
    }

    private mapStringToDayOfWeek(day: string): DayOfWeek {
        const dayMap: Record<string, DayOfWeek> = {
            'monday': DayOfWeek.MONDAY,
            'tuesday': DayOfWeek.TUESDAY,
            'wednesday': DayOfWeek.WEDNESDAY,
            'thursday': DayOfWeek.THURSDAY,
            'friday': DayOfWeek.FRIDAY,
            'saturday': DayOfWeek.SATURDAY,
            'sunday': DayOfWeek.SUNDAY
        };

        const normalizedDay = day.toLowerCase();
        const dayOfWeek = dayMap[normalizedDay];
        
        if (!dayOfWeek) {
            throw new Error(`Invalid day: ${day}`);
        }

        return dayOfWeek;
    }
}
