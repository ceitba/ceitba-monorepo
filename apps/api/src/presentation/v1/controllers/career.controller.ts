import { Request, Response } from 'express';
import { CareerService } from '../../../domain/itba/services/career.service';

export class CareerController {
    constructor(private readonly careerService: CareerService) {}

    async getCareerPlans(req: Request, res: Response): Promise<void> {
        try {
            const careerPlans = await this.careerService.getCareersWithPlans();
            res.json(careerPlans);
        } catch (error) {
            console.error('Error fetching career plans:', error);
            res.status(500).json({ error: 'Error fetching career plans' });
        }
    }

    
    async getAllCareers(req: Request, res: Response): Promise<void> {
        try {
            const careers = await this.careerService.getAllCareers();
            res.json(careers);
        } catch (error) {
            console.error('Error fetching careers:', error);
            res.status(500).json({ error: 'Error fetching careers' });
        }
    }

    async getCareerById(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const career = await this.careerService.getCareerById(id);
            
            if (!career) {
                res.status(404).json({ error: 'Career not found' });
                return;
            }

            res.json(career);
        } catch (error) {
            console.error('Error fetching career:', error);
            res.status(500).json({ error: 'Error fetching career' });
        }
    }

    async createCareer(req: Request, res: Response): Promise<void> {
        try {
            const { id, name } = req.body;

            if (!id || !name) {
                res.status(400).json({ error: 'ID and name are required' });
                return;
            }

            const career = await this.careerService.createCareer({ id, name });
            res.status(201).json(career);
        } catch (error) {
            console.error('Error creating career:', error);
            res.status(500).json({ error: 'Error creating career' });
        }
    }

    async updateCareer(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const updateData = req.body;

            const career = await this.careerService.updateCareer(id, updateData);
            
            if (!career) {
                res.status(404).json({ error: 'Career not found' });
                return;
            }

            res.json(career);
        } catch (error) {
            console.error('Error updating career:', error);
            res.status(500).json({ error: 'Error updating career' });
        }
    }

    async deleteCareer(req: Request, res: Response): Promise<void> {
        try {
            const { id } = req.params;
            const deleted = await this.careerService.deleteCareer(id);
            
            if (!deleted) {
                res.status(404).json({ error: 'Career not found' });
                return;
            }

            res.status(204).send();
        } catch (error) {
            console.error('Error deleting career:', error);
            res.status(500).json({ error: 'Error deleting career' });
        }
    }
}
