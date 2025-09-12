import { Request, Response } from 'express';
import { ClassroomService } from '@/domain/itba/services/classroom.service';
import { ItbaMappers } from '@/presentation/mappers/itba.mappers';

export class ClassroomController {
    constructor(private readonly classroomService: ClassroomService) {}

    async getOccupiedClassrooms(req: Request, res: Response): Promise<void> {
        try {
            const { current_semester } = req.query;
            const currentSemester = current_semester === 'true' || current_semester === undefined;
            
            const occupiedClassrooms = await this.classroomService.getOccupiedClassrooms(currentSemester);
            const dto = ItbaMappers.groupClassroomsByDayAndBuilding(occupiedClassrooms);
            res.json(dto);
        } catch (error) {
            console.error('Error fetching occupied classrooms:', error);
            res.status(500).json({ error: 'Error fetching occupied classrooms' });
        }
    }

    async getAllClassrooms(req: Request, res: Response): Promise<void> {
        try {
            const allClassrooms = await this.classroomService.getAllClassrooms();
            const dto = ItbaMappers.groupClassroomsByBuilding(allClassrooms);
            res.json(dto);
        } catch (error) {
            console.error('Error fetching all classrooms:', error);
            res.status(500).json({ error: 'Error fetching all classrooms' });
        }
    }

    async getClassroomsByBuilding(req: Request, res: Response): Promise<void> {
        try {
            const { building } = req.params;
            const classrooms = await this.classroomService.getClassroomsByBuilding(building);
            const dto = ItbaMappers.classroomSchedulesToDto(classrooms);
            res.json(dto);
        } catch (error) {
            console.error('Error fetching classrooms by building:', error);
            res.status(500).json({ error: 'Error fetching classrooms by building' });
        }
    }

    async getAvailableClassrooms(req: Request, res: Response): Promise<void> {
        try {
            const availableClassrooms = await this.classroomService.getAvailableClassrooms();
            const dto = ItbaMappers.groupClassroomsByBuilding(availableClassrooms);
            res.json(dto);
        } catch (error) {
            console.error('Error fetching available classrooms:', error);
            res.status(500).json({ error: 'Error fetching available classrooms' });
        }
    }

    async getClassroomsByDay(req: Request, res: Response): Promise<void> {
        try {
            const { day } = req.params;
            const classrooms = await this.classroomService.getClassroomsByDay(day);
            const dto = ItbaMappers.classroomSchedulesToScheduleDto(classrooms);
            res.json(dto);
        } catch (error) {
            console.error('Error fetching classrooms by day:', error);
            res.status(500).json({ error: 'Error fetching classrooms by day' });
        }
    }

    async checkConflicts(req: Request, res: Response): Promise<void> {
        try {
            const { classroom, building, day, hourFrom, hourTo } = req.body;

            if (!classroom || !building || !day || !hourFrom || !hourTo) {
                res.status(400).json({ 
                    error: 'All fields are required: classroom, building, day, hourFrom, hourTo' 
                });
                return;
            }

            const conflicts = await this.classroomService.checkForConflicts(
                classroom, building, day, hourFrom, hourTo
            );
            const dto = ItbaMappers.classroomSchedulesToScheduleDto(conflicts);
            res.json(dto);
        } catch (error) {
            console.error('Error checking classroom conflicts:', error);
            res.status(500).json({ error: 'Error checking classroom conflicts' });
        }
    }
}
