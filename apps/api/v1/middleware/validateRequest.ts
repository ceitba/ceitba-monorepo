import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';

export const validateRequest = (schema: AnyZodObject) => 
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      // Check if body exists and is not empty
      if (!req.body || Object.keys(req.body).length === 0) {
        res.status(400).json({ 
          error: 'Validation failed', 
          details: [{ field: 'body', message: 'Request body is required' }]
        });
        return;
      }

      // Validate against schema
      const validData = schema.parse(req.body);
      // Attach validated data to request
      req.body = validData;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ 
          error: 'Validation failed', 
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      } else {
        console.error('Validation error:', error);
        res.status(400).json({ error: 'Invalid request data' });
      }
    }
  }; 