import { Request, Response } from 'express';
import { SubjectPlanService } from '@/domain/itba/services/subject-plan.service';

export class SubjectPlanController {
    constructor(private readonly subjectPlanService: SubjectPlanService) {}

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
