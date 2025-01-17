import { Request, Response, NextFunction } from 'express';
import { AnyZodObject } from 'zod';

export const validateRequest = (schema: AnyZodObject) => 
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      res.status(400).json({ error: 'Invalid request data' });
    }
  }; 