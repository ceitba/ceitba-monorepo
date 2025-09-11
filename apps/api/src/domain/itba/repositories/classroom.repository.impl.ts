import { ClassroomSchedule, Classroom, TimeSlot, DayOfWeek } from '../models/classroom.model';
import { ClassroomRepository } from '../interfaces/classroom.repository.interface';
import { DatabaseClient, DatabaseFactory } from '../../../shared/database';

export class ClassroomRepositoryImpl implements ClassroomRepository {
    private readonly db: DatabaseClient;

    constructor(db?: DatabaseClient) {
        this.db = db || DatabaseFactory.getInstance();
    }

    async findAllClassrooms(): Promise<ClassroomSchedule[]> {
        const result = await this.db.rpc<any[]>('get_all_classrooms');

        if (result.error) {
            throw new Error(`Error fetching all classrooms: ${result.error.message}`);
        }

        return result.data!.map(this.mapToClassroomSchedule);
    }

    async findOccupiedClassrooms(currentSemester: boolean = true): Promise<ClassroomSchedule[]> {
        const result = await this.db.rpc<any[]>('get_classrooms', { 
            current_semester: currentSemester 
        });

        if (result.error) {
            throw new Error(`Error fetching occupied classrooms: ${result.error.message}`);
        }

        return result.data!.map(this.mapToClassroomSchedule);
    }

    async findByBuilding(building: string): Promise<ClassroomSchedule[]> {
        // This would require a custom RPC or query depending on your database structure
        const allClassrooms = await this.findAllClassrooms();
        return allClassrooms.filter(schedule => 
            schedule.classroom.building.toLowerCase() === building.toLowerCase()
        );
    }

    async findByDay(day: string): Promise<ClassroomSchedule[]> {
        const occupiedClassrooms = await this.findOccupiedClassrooms();
        return occupiedClassrooms.filter(schedule => 
            schedule.day?.toLowerCase() === day.toLowerCase()
        );
    }

    async findAvailableClassrooms(): Promise<ClassroomSchedule[]> {
        const allClassrooms = await this.findAllClassrooms();
        return allClassrooms.filter(schedule => schedule.isAvailable());
    }

    async findConflicts(schedule: ClassroomSchedule): Promise<ClassroomSchedule[]> {
        const occupiedClassrooms = await this.findOccupiedClassrooms();
        return occupiedClassrooms.filter(existing => existing.conflictsWith(schedule));
    }

    private mapToClassroomSchedule(data: any): ClassroomSchedule {
        const classroom = new Classroom(data.class_room, data.building);
        
        let timeSlot: TimeSlot | null = null;
        if (data.hour_from && data.hour_to) {
            timeSlot = new TimeSlot(data.hour_from, data.hour_to);
        }

        let dayOfWeek: DayOfWeek | null = null;
        if (data.day) {
            dayOfWeek = this.mapStringToDayOfWeek(data.day);
        }

        return new ClassroomSchedule(classroom, dayOfWeek, timeSlot);
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
            // Fallback to first value if mapping fails
            return DayOfWeek.MONDAY;
        }

        return dayOfWeek;
    }
}
