import { Request, Response } from 'express';
import { CareerService } from '../../../domain/itba/services/career.service';

export class CareerController {
    constructor(private readonly careerService: CareerService) {}

    /**
     * @openapi
     * /api/v1/itba/career/plans:
     *   get:
     *     tags:
     *       - ITBA Careers
     *     summary: Retrieve career plans
     *     description: >
     *       Retrieves a list of career plans grouped by career ID and name.
     *     responses:
     *       200:
     *         description: A map of career IDs to career details, including plans.
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               additionalProperties:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   name:
     *                     type: string
     *                   plans:
     *                     type: array
     *                     items:
     *                       type: string
     *       500:
     *         description: Internal server error
     */
    async getCareerPlans(req: Request, res: Response): Promise<void> {
        try {
            const careerPlans = await this.careerService.getCareersWithPlans();
            res.json(careerPlans);
        } catch (error) {
            console.error('Error fetching career plans:', error);
            res.status(500).json({ error: 'Error fetching career plans' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/career:
     *   get:
     *     tags:
     *       - ITBA Careers
     *     summary: Get all careers
     *     description: Retrieves a list of all careers
     *     responses:
     *       200:
     *         description: List of careers
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   name:
     *                     type: string
     *                   plans:
     *                     type: array
     *                     items:
     *                       type: string
     *       500:
     *         description: Internal server error
     */
    async getAllCareers(req: Request, res: Response): Promise<void> {
        try {
            const careers = await this.careerService.getAllCareers();
            res.json(careers);
        } catch (error) {
            console.error('Error fetching careers:', error);
            res.status(500).json({ error: 'Error fetching careers' });
        }
    }

    /**
     * @openapi
     * /api/v1/itba/career/{id}:
     *   get:
     *     tags:
     *       - ITBA Careers
     *     summary: Get career by ID
     *     description: Retrieves a specific career by its ID
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Career ID
     *     responses:
     *       200:
     *         description: Career details
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 id:
     *                   type: string
     *                 name:
     *                   type: string
     *                 plans:
     *                   type: array
     *                   items:
     *                     type: string
     *       404:
     *         description: Career not found
     *       500:
     *         description: Internal server error
     */
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

    /**
     * @openapi
     * /api/v1/itba/career:
     *   post:
     *     tags:
     *       - ITBA Careers
     *     summary: Create a new career
     *     description: Creates a new career
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - id
     *               - name
     *             properties:
     *               id:
     *                 type: string
     *               name:
     *                 type: string
     *     responses:
     *       201:
     *         description: Career created successfully
     *       400:
     *         description: Invalid request data
     *       500:
     *         description: Internal server error
     */
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

    /**
     * @openapi
     * /api/v1/itba/career/{id}:
     *   put:
     *     tags:
     *       - ITBA Careers
     *     summary: Update a career
     *     description: Updates an existing career
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Career ID
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               name:
     *                 type: string
     *     responses:
     *       200:
     *         description: Career updated successfully
     *       404:
     *         description: Career not found
     *       500:
     *         description: Internal server error
     */
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

    /**
     * @openapi
     * /api/v1/itba/career/{id}:
     *   delete:
     *     tags:
     *       - ITBA Careers
     *     summary: Delete a career
     *     description: Deletes an existing career
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Career ID
     *     responses:
     *       204:
     *         description: Career deleted successfully
     *       404:
     *         description: Career not found
     *       500:
     *         description: Internal server error
     */
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
