import { Request, Response } from 'express';
import { SubjectPlanService } from '../../../domain/itba/services/subject-plan.service';

export class SubjectPlanController {
    constructor(private readonly subjectPlanService: SubjectPlanService) {}

    /**
     * @openapi
     * /api/v1/itba/subjects/plan/{planId}:
     *   get:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Get subjects by plan ID
     *     description: Retrieves all subjects for a specific plan from the database
     *     parameters:
     *       - in: path
     *         name: planId
     *         required: true
     *         schema:
     *           type: string
     *         description: Plan ID
     *     responses:
     *       200:
     *         description: List of subjects in the plan
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   subjectId:
     *                     type: string
     *                   planId:
     *                     type: string
     *                   section:
     *                     type: string
     *                   year:
     *                     type: number
     *                     nullable: true
     *                   semester:
     *                     type: number
     *                     nullable: true
     *                   dependencies:
     *                     type: array
     *                     items:
     *                       type: string
     *                   creditsRequired:
     *                     type: number
     *                     nullable: true
     *                   subject:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: string
     *                       name:
     *                         type: string
     *                       credits:
     *                         type: number
     *       500:
     *         description: Internal server error
     */
    async getSubjectsByPlan(req: Request, res: Response): Promise<void> {
        try {
            const { planId } = req.params;
            const subjects = await this.subjectPlanService.getSubjectsByPlan(planId);
            res.json(subjects);
        } catch (error) {
            console.error('Error fetching subjects by plan:', error);
            res.status(500).json({ error: 'Error fetching subjects by plan' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/subjects/plan/{planId}/api:
     *   get:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Get subjects by plan ID from ITBA API
     *     description: Retrieves all subjects for a specific plan from the external ITBA API
     *     parameters:
     *       - in: path
     *         name: planId
     *         required: true
     *         schema:
     *           type: string
     *         description: Plan ID
     *     responses:
     *       200:
     *         description: List of subjects in the plan from ITBA API
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   subjectId:
     *                     type: string
     *                   planId:
     *                     type: string
     *                   section:
     *                     type: string
     *                   year:
     *                     type: number
     *                     nullable: true
     *                   semester:
     *                     type: number
     *                     nullable: true
     *                   dependencies:
     *                     type: array
     *                     items:
     *                       type: string
     *                   creditsRequired:
     *                     type: number
     *                     nullable: true
     *                   subject:
     *                     type: object
     *                     properties:
     *                       id:
     *                         type: string
     *                       name:
     *                         type: string
     *                       credits:
     *                         type: number
     *       500:
     *         description: Internal server error
     */
    async getSubjectsByPlanFromApi(req: Request, res: Response): Promise<void> {
        try {
            const { planId } = req.params;
            const subjects = await this.subjectPlanService.getSubjectsByPlanFromApi(planId);
            res.json(subjects);
        } catch (error) {
            console.error('Error fetching subjects from ITBA API:', error);
            res.status(500).json({ error: 'Error fetching subjects from ITBA API' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/subjects/{subjectId}/plans:
     *   get:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Get plans by subject ID
     *     description: Retrieves all plans that contain a specific subject
     *     parameters:
     *       - in: path
     *         name: subjectId
     *         required: true
     *         schema:
     *           type: string
     *         description: Subject ID
     *     responses:
     *       200:
     *         description: List of subject plans containing the subject
     *       500:
     *         description: Internal server error
     */
    async getSubjectPlansBySubject(req: Request, res: Response): Promise<void> {
        try {
            const { subjectId } = req.params;
            const subjectPlans = await this.subjectPlanService.getSubjectPlansBySubject(subjectId);
            res.json(subjectPlans);
        } catch (error) {
            console.error('Error fetching subject plans by subject:', error);
            res.status(500).json({ error: 'Error fetching subject plans by subject' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/subjects/plan/{planId}/section/{section}:
     *   get:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Get subjects by plan and section
     *     description: Retrieves all subjects in a specific plan section
     *     parameters:
     *       - in: path
     *         name: planId
     *         required: true
     *         schema:
     *           type: string
     *         description: Plan ID
     *       - in: path
     *         name: section
     *         required: true
     *         schema:
     *           type: string
     *         description: Section name
     *     responses:
     *       200:
     *         description: List of subjects in the plan section
     *       500:
     *         description: Internal server error
     */
    async getSubjectsBySection(req: Request, res: Response): Promise<void> {
        try {
            const { planId, section } = req.params;
            const subjects = await this.subjectPlanService.getSubjectsBySection(planId, section);
            res.json(subjects);
        } catch (error) {
            console.error('Error fetching subjects by section:', error);
            res.status(500).json({ error: 'Error fetching subjects by section' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/subjects/plan/{planId}/electives:
     *   get:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Get elective subjects
     *     description: Retrieves all elective subjects for a specific plan
     *     parameters:
     *       - in: path
     *         name: planId
     *         required: true
     *         schema:
     *           type: string
     *         description: Plan ID
     *     responses:
     *       200:
     *         description: List of elective subjects
     *       500:
     *         description: Internal server error
     */
    async getElectiveSubjects(req: Request, res: Response): Promise<void> {
        try {
            const { planId } = req.params;
            const subjects = await this.subjectPlanService.getElectiveSubjects(planId);
            res.json(subjects);
        } catch (error) {
            console.error('Error fetching elective subjects:', error);
            res.status(500).json({ error: 'Error fetching elective subjects' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/subjects/plan/{planId}/year/{year}:
     *   get:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Get subjects by year
     *     description: Retrieves all subjects for a specific plan and year
     *     parameters:
     *       - in: path
     *         name: planId
     *         required: true
     *         schema:
     *           type: string
     *         description: Plan ID
     *       - in: path
     *         name: year
     *         required: true
     *         schema:
     *           type: integer
     *         description: Academic year
     *     responses:
     *       200:
     *         description: List of subjects for the year
     *       500:
     *         description: Internal server error
     */
    async getSubjectsByYear(req: Request, res: Response): Promise<void> {
        try {
            const { planId, year } = req.params;
            const yearNum = parseInt(year, 10);
            
            if (isNaN(yearNum)) {
                res.status(400).json({ error: 'Year must be a valid number' });
                return;
            }

            const subjects = await this.subjectPlanService.getSubjectsByYear(planId, yearNum);
            res.json(subjects);
        } catch (error) {
            console.error('Error fetching subjects by year:', error);
            res.status(500).json({ error: 'Error fetching subjects by year' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/subjects/plan/{planId}/year/{year}/semester/{semester}:
     *   get:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Get subjects by semester
     *     description: Retrieves all subjects for a specific plan, year, and semester
     *     parameters:
     *       - in: path
     *         name: planId
     *         required: true
     *         schema:
     *           type: string
     *         description: Plan ID
     *       - in: path
     *         name: year
     *         required: true
     *         schema:
     *           type: integer
     *         description: Academic year
     *       - in: path
     *         name: semester
     *         required: true
     *         schema:
     *           type: integer
     *         description: Semester (1 or 2)
     *     responses:
     *       200:
     *         description: List of subjects for the semester
     *       400:
     *         description: Invalid year or semester
     *       500:
     *         description: Internal server error
     */
    async getSubjectsBySemester(req: Request, res: Response): Promise<void> {
        try {
            const { planId, year, semester } = req.params;
            const yearNum = parseInt(year, 10);
            const semesterNum = parseInt(semester, 10);
            
            if (isNaN(yearNum) || isNaN(semesterNum)) {
                res.status(400).json({ error: 'Year and semester must be valid numbers' });
                return;
            }

            if (semesterNum < 1 || semesterNum > 2) {
                res.status(400).json({ error: 'Semester must be 1 or 2' });
                return;
            }

            const subjects = await this.subjectPlanService.getSubjectsBySemester(planId, yearNum, semesterNum);
            res.json(subjects);
        } catch (error) {
            console.error('Error fetching subjects by semester:', error);
            res.status(500).json({ error: 'Error fetching subjects by semester' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/subjects/plan/{planId}/subject/{subjectId}/dependencies:
     *   get:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Get subject dependencies
     *     description: Retrieves all dependencies for a specific subject in a plan
     *     parameters:
     *       - in: path
     *         name: planId
     *         required: true
     *         schema:
     *           type: string
     *         description: Plan ID
     *       - in: path
     *         name: subjectId
     *         required: true
     *         schema:
     *           type: string
     *         description: Subject ID
     *     responses:
     *       200:
     *         description: List of subject dependencies
     *       500:
     *         description: Internal server error
     */
    async getSubjectDependencies(req: Request, res: Response): Promise<void> {
        try {
            const { planId, subjectId } = req.params;
            const dependencies = await this.subjectPlanService.getSubjectDependencies(planId, subjectId);
            res.json(dependencies);
        } catch (error) {
            console.error('Error fetching subject dependencies:', error);
            res.status(500).json({ error: 'Error fetching subject dependencies' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/subjects/plan:
     *   post:
     *     tags:
     *       - ITBA Subject Plans
     *     summary: Create a subject plan
     *     description: Creates a new subject plan relationship
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - subjectId
     *               - planId
     *               - section
     *             properties:
     *               subjectId:
     *                 type: string
     *               planId:
     *                 type: string
     *               section:
     *                 type: string
     *               year:
     *                 type: number
     *                 nullable: true
     *               semester:
     *                 type: number
     *                 nullable: true
     *               dependencies:
     *                 type: array
     *                 items:
     *                   type: string
     *               creditsRequired:
     *                 type: number
     *                 nullable: true
     *     responses:
     *       201:
     *         description: Subject plan created successfully
     *       400:
     *         description: Invalid request data
     *       500:
     *         description: Internal server error
     */
    async createSubjectPlan(req: Request, res: Response): Promise<void> {
        try {
            const createData = req.body;

            if (!createData.subjectId || !createData.planId || !createData.section) {
                res.status(400).json({ 
                    error: 'Subject ID, plan ID, and section are required' 
                });
                return;
            }

            // Ensure dependencies is an array
            if (!createData.dependencies) {
                createData.dependencies = [];
            }

            const subjectPlan = await this.subjectPlanService.createSubjectPlan(createData);
            res.status(201).json(subjectPlan);
        } catch (error) {
            console.error('Error creating subject plan:', error);
            res.status(500).json({ error: 'Error creating subject plan' });
        }
    }
}
