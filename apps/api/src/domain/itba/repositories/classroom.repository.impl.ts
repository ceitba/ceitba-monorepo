import { ClassroomSchedule, Classroom, TimeSlot, DayOfWeek, DayOfWeekMapper } from '@/domain/itba/models/classroom.model';
import { ClassroomRepository } from '@/domain/itba/interfaces/repositories/classroom.repository.interface';
import { PrismaService } from '@/shared/database/prisma.service';

export class ClassroomRepositoryImpl implements ClassroomRepository {

    private readonly prisma: PrismaService;
    
    constructor(prisma: PrismaService) {
        this.prisma = prisma;
    }

    async findAllClassrooms(): Promise<ClassroomSchedule[]> {
        const result = await this.prisma.commissionTime.findMany({
            distinct: ['building', 'classroom'],  
            select: { building: true, classroom: true },
            orderBy: [{ building: 'asc' }, { classroom: 'asc' }],
            });

        return result.map(this.mapToClassroomSchedule);
    }

    async findOccupiedClassrooms(currentSemester: boolean = true): Promise<ClassroomSchedule[]> {

        const today = new Date();

        const result = await this.prisma.commissionTime.findMany({ 
           where: currentSemester
            ? {
            commission: {
                courseStart: { lte: today },
                courseEnd:   { gte: today },
                },
            }
        : {},
        select: { building: true, classroom: true, day: true, hourFrom: true, hourTo: true
        },
        distinct: ['building', 'classroom', 'day', 'hourFrom', 'hourTo'],
        orderBy: [{ building: 'asc' }, { classroom: 'asc' }, { day: 'asc' }, { hourFrom: 'asc' }, { hourTo: 'asc' } ],
        });

        return result.map(this.mapToClassroomSchedule);
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
        const classroom = new Classroom(data.classroom, data.building);
        
        let timeSlot: TimeSlot | null = null;
        if (data.hourFrom && data.hourTo) {
            timeSlot = new TimeSlot(data.hourFrom, data.hourTo);
        }

        const dayOfWeek = DayOfWeekMapper.fromStringOrNull(data.day);

        return new ClassroomSchedule(classroom, dayOfWeek, timeSlot);
    }

}
