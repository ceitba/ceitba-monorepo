import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError, ZodSchema } from 'zod';

export const validateQuery = (schema: ZodSchema) => 
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validData = schema.parse(req.query);
      req.query = validData;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ 
          error: 'Query validation failed', 
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      } else {
        console.error('Query validation error:', error);
        res.status(400).json({ error: 'Invalid query parameters' });
      }
    }
  };

export const validateParams = (schema: ZodSchema) => 
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validData = schema.parse(req.params);
      req.params = validData;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({ 
          error: 'Path parameter validation failed', 
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      } else {
        console.error('Path parameter validation error:', error);
        res.status(400).json({ error: 'Invalid path parameters' });
      }
    }
  };
