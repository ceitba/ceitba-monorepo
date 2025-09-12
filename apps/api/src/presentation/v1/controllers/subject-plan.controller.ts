import { Request, Response, NextFunction } from 'express';
import { SubjectPlanService } from '@/domain/itba/services/subject-plan.service';
import { SubjectPlanQuery, CreateSubjectPlanRequest, UpdateSubjectPlanRequest } from '@/shared/validation/subject-plan.schemas';

export class SubjectPlanController {
    constructor(private readonly subjectPlanService: SubjectPlanService) {}

    async getSubjectsByPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { planId } = req.params;
            const query = req.query as unknown as SubjectPlanQuery;
            
            const subjects = await this.subjectPlanService.getSubjectsByPlanWithFilters(planId, {
                year: query.year || undefined,
                semester: query.semester || undefined,
                section: query.section,
                type: query.type
            });
            
            res.json(subjects);
        } catch (error) {
            next(error);
        }
    }

    async getSubjectsByPlanFromApi(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { planId } = req.params;
            const subjects = await this.subjectPlanService.getSubjectsByPlanFromApi(planId);
            res.json(subjects);
        } catch (error) {
            next(error);
        }
    }

    async getSubjectPlansBySubject(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { subjectId } = req.params;
            const subjectPlans = await this.subjectPlanService.getSubjectPlansBySubject(subjectId);
            res.json(subjectPlans);
        } catch (error) {
            next(error);
        }
    }

    async getSubjectPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { planId, subjectId } = req.params;
            const subjectPlan = await this.subjectPlanService.getSubjectPlan(planId, subjectId);
            
            if (!subjectPlan) {
                res.status(404).json({ error: 'Subject plan not found' });
                return;
            }
            
            res.json(subjectPlan);
        } catch (error) {
            next(error);
        }
    }

    async createSubjectPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { planId } = req.params;
            const createData = req.body as CreateSubjectPlanRequest;

            // Add planId from route parameter to the request data
            const createSubjectPlanDto = {
                ...createData,
                planId,
                year: createData.year ?? null,
                semester: createData.semester ?? null,
                creditsRequired: createData.creditsRequired ?? null
            };

            const subjectPlan = await this.subjectPlanService.createSubjectPlan(createSubjectPlanDto);
            res.status(201).json(subjectPlan);
        } catch (error) {
            next(error);
        }
    }

    async updateSubjectPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { planId, subjectId } = req.params;
            const updateData = req.body as UpdateSubjectPlanRequest;

            const updatedSubjectPlan = await this.subjectPlanService.updateSubjectPlan(planId, subjectId, updateData);
            
            if (!updatedSubjectPlan) {
                res.status(404).json({ error: 'Subject plan not found' });
                return;
            }

            res.json(updatedSubjectPlan);
        } catch (error) {
            next(error);
        }
    }

    async deleteSubjectPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { planId, subjectId } = req.params;
            const deleted = await this.subjectPlanService.deleteSubjectPlan(planId, subjectId);
            
            if (!deleted) {
                res.status(404).json({ error: 'Subject plan not found' });
                return;
            }

            res.status(204).send();
        } catch (error) {
            next(error);
        }
    }

    async getSubjectDependencies(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { subjectId } = req.params;
            const { planId } = req.query as { planId: string };
            
            const dependencies = await this.subjectPlanService.getSubjectDependencies(planId, subjectId);
            res.json(dependencies);
        } catch (error) {
            next(error);
        }
    }
}