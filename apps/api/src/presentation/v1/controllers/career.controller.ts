import { Request, Response, NextFunction } from 'express';
import { CareerService } from '@/domain/itba/services/career.service';
import { CreateCareerRequest, UpdateCareerRequest } from '@/shared/validation/subject-plan.schemas';

export class CareerController {
    constructor(private readonly careerService: CareerService) {}

    async getCareerPlans(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const careerPlans = await this.careerService.getCareersWithPlans();
            res.json(careerPlans);
        } catch (error) {
            next(error);
        }
    }

    
    async getAllCareers(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const careers = await this.careerService.getAllCareers();
            res.json(careers);
        } catch (error) {
            next(error);
        }
    }

    async getCareerById(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const career = await this.careerService.getCareerById(id);
            
            if (!career) {
                res.status(404).json({ error: 'Career not found' });
                return;
            }

            res.json(career);
        } catch (error) {
            next(error);
        }
    }

    async createCareer(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const createData = req.body as CreateCareerRequest;
            const career = await this.careerService.createCareer(createData);
            res.status(201).json(career);
        } catch (error) {
            next(error);
        }
    }

    async updateCareer(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const updateData = req.body as UpdateCareerRequest;

            const career = await this.careerService.updateCareer(id, updateData);
            
            if (!career) {
                res.status(404).json({ error: 'Career not found' });
                return;
            }

            res.json(career);
        } catch (error) {
            next(error);
        }
    }

    async deleteCareer(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.careerService.deleteCareer(id);
            
            if (!deleted) {
                res.status(404).json({ error: 'Career not found' });
                return;
            }

            res.status(204).send();
        } catch (error) {
            next(error);
        }
    }
}
