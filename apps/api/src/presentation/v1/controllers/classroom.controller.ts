import { Request, Response } from 'express';
import { ClassroomService } from '../../../domain/itba/services/classroom.service';

export class ClassroomController {
    constructor(private readonly classroomService: ClassroomService) {}

    /**
     * @openapi
     * /api/v1/itba/classrooms/occupied:
     *   get:
     *     tags:
     *       - ITBA Classrooms
     *     summary: Retrieve occupied classroom data
     *     description: >
     *       Retrieves a list of occupied classrooms.
     *       The optional "current_semester" query parameter determines whether to filter
     *       results only for the current semester. Otherwise, all classrooms in the database are returned.
     *       The results are grouped by weekday and building.
     *     parameters:
     *       - in: query
     *         name: current_semester
     *         required: false
     *         schema:
     *           type: boolean
     *         description: If set to true, only returns active classrooms for the current semester.
     *     responses:
     *       200:
     *         description: A map of days to maps of buildings to arrays of classroom data.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties:
     *                 type: object
     *                 additionalProperties:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       classroom:
     *                         type: string
     *                       building:
     *                         type: string
     *                       day:
     *                         type: string
     *                       hourFrom:
     *                         type: string
     *                       hourTo:
     *                         type: string
     *       500:
     *         description: Internal server error
     */
    async getOccupiedClassrooms(req: Request, res: Response): Promise<void> {
        try {
            const { current_semester } = req.query;
            const currentSemester = current_semester === 'true' || current_semester === undefined;
            
            const occupiedClassrooms = await this.classroomService.getOccupiedClassrooms(currentSemester);
            res.json(occupiedClassrooms);
        } catch (error) {
            console.error('Error fetching occupied classrooms:', error);
            res.status(500).json({ error: 'Error fetching occupied classrooms' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/classrooms/all:
     *   get:
     *     tags:
     *       - ITBA Classrooms
     *     summary: Retrieve all classroom data
     *     description: >
     *       Retrieves a list of all classrooms in the database.
     *       The results are grouped by building.
     *     responses:
     *       200:
     *         description: A map of buildings to arrays of classroom data.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     name:
     *                       type: string
     *                     building:
     *                       type: string
     *       500:
     *         description: Internal server error
     */
    async getAllClassrooms(req: Request, res: Response): Promise<void> {
        try {
            const allClassrooms = await this.classroomService.getAllClassrooms();
            res.json(allClassrooms);
        } catch (error) {
            console.error('Error fetching all classrooms:', error);
            res.status(500).json({ error: 'Error fetching all classrooms' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/classrooms/building/{building}:
     *   get:
     *     tags:
     *       - ITBA Classrooms
     *     summary: Get classrooms by building
     *     description: Retrieves all classrooms in a specific building
     *     parameters:
     *       - in: path
     *         name: building
     *         required: true
     *         schema:
     *           type: string
     *         description: Building name
     *     responses:
     *       200:
     *         description: List of classrooms in the building
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   name:
     *                     type: string
     *                   building:
     *                     type: string
     *                   day:
     *                     type: string
     *                   hourFrom:
     *                     type: string
     *                   hourTo:
     *                     type: string
     *       500:
     *         description: Internal server error
     */
    async getClassroomsByBuilding(req: Request, res: Response): Promise<void> {
        try {
            const { building } = req.params;
            const classrooms = await this.classroomService.getClassroomsByBuilding(building);
            res.json(classrooms);
        } catch (error) {
            console.error('Error fetching classrooms by building:', error);
            res.status(500).json({ error: 'Error fetching classrooms by building' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/classrooms/day/{day}:
     *   get:
     *     tags:
     *       - ITBA Classrooms
     *     summary: Get classrooms by day
     *     description: Retrieves all occupied classrooms for a specific day
     *     parameters:
     *       - in: path
     *         name: day
     *         required: true
     *         schema:
     *           type: string
     *         description: Day of the week
     *     responses:
     *       200:
     *         description: List of classroom schedules for the day
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   classroom:
     *                     type: string
     *                   building:
     *                     type: string
     *                   day:
     *                     type: string
     *                   hourFrom:
     *                     type: string
     *                   hourTo:
     *                     type: string
     *       500:
     *         description: Internal server error
     */
    async getClassroomsByDay(req: Request, res: Response): Promise<void> {
        try {
            const { day } = req.params;
            const classrooms = await this.classroomService.getClassroomsByDay(day);
            res.json(classrooms);
        } catch (error) {
            console.error('Error fetching classrooms by day:', error);
            res.status(500).json({ error: 'Error fetching classrooms by day' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/classrooms/available:
     *   get:
     *     tags:
     *       - ITBA Classrooms
     *     summary: Get available classrooms
     *     description: Retrieves all available (unoccupied) classrooms grouped by building
     *     responses:
     *       200:
     *         description: Map of buildings to available classrooms
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties:
     *                 type: array
     *                 items:
     *                   type: object
     *                   properties:
     *                     name:
     *                       type: string
     *                     building:
     *                       type: string
     *       500:
     *         description: Internal server error
     */
    async getAvailableClassrooms(req: Request, res: Response): Promise<void> {
        try {
            const availableClassrooms = await this.classroomService.getAvailableClassrooms();
            res.json(availableClassrooms);
        } catch (error) {
            console.error('Error fetching available classrooms:', error);
            res.status(500).json({ error: 'Error fetching available classrooms' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/classrooms/conflicts:
     *   post:
     *     tags:
     *       - ITBA Classrooms
     *     summary: Check for classroom conflicts
     *     description: Checks if a classroom schedule conflicts with existing schedules
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - classroom
     *               - building
     *               - day
     *               - hourFrom
     *               - hourTo
     *             properties:
     *               classroom:
     *                 type: string
     *               building:
     *                 type: string
     *               day:
     *                 type: string
     *               hourFrom:
     *                 type: string
     *               hourTo:
     *                 type: string
     *     responses:
     *       200:
     *         description: List of conflicting schedules
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   classroom:
     *                     type: string
     *                   building:
     *                     type: string
     *                   day:
     *                     type: string
     *                   hourFrom:
     *                     type: string
     *                   hourTo:
     *                     type: string
     *       400:
     *         description: Invalid request data
     *       500:
     *         description: Internal server error
     */
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
            res.json(conflicts);
        } catch (error) {
            console.error('Error checking classroom conflicts:', error);
            res.status(500).json({ error: 'Error checking classroom conflicts' });
        }
    }
}
