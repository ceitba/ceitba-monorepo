import { Request, Response, NextFunction } from 'express';
import { ClassroomService } from '@/domain/itba/services/classroom.service';
import { ItbaMappers } from '@/presentation/mappers/itba.mappers';
import { ClassroomQuery, ClassroomConflictRequest } from '@/shared/validation/subject-plan.schemas';

export class ClassroomController {
    constructor(private readonly classroomService: ClassroomService) {}

    async getClassrooms(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const query = req.query as unknown as ClassroomQuery;
            
            const classrooms = await this.classroomService.getClassroomsWithFilters({
                status: query.status,
                current_semester: query.current_semester
            });

            // Apply appropriate mapping based on status
            if (query.status === 'occupied') {
                const dto = ItbaMappers.groupClassroomsByDayAndBuilding(classrooms);
                res.json(dto);
            } else {
                const dto = ItbaMappers.groupClassroomsByBuilding(classrooms);
                res.json(dto);
            }
        } catch (error) {
            next(error);
        }
    }

    async getClassroomsByBuilding(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { building } = req.params;
            const classrooms = await this.classroomService.getClassroomsByBuilding(building);
            const dto = ItbaMappers.classroomSchedulesToDto(classrooms);
            res.json(dto);
        } catch (error) {
            next(error);
        }
    }

    async getClassroomsByDay(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { day } = req.params;
            const classrooms = await this.classroomService.getClassroomsByDay(day);
            const dto = ItbaMappers.classroomSchedulesToScheduleDto(classrooms);
            res.json(dto);
        } catch (error) {
            next(error);
        }
    }

    async checkConflicts(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const conflictRequest = req.body as ClassroomConflictRequest;

            const conflicts = await this.classroomService.checkForConflicts(
                conflictRequest.classroom,
                conflictRequest.building,
                conflictRequest.day,
                conflictRequest.hourFrom,
                conflictRequest.hourTo
            );
            
            const dto = ItbaMappers.classroomSchedulesToScheduleDto(conflicts);
            res.json(dto);
        } catch (error) {
            next(error);
        }
    }
}