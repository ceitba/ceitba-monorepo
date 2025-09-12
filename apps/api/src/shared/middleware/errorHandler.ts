import { Request, Response, NextFunction } from 'express';
import { ValidationException, ResourceNotFoundException, DomainException } from '@/shared/exceptions/domain.exceptions';

export const errorHandler = (
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    console.error('Error occurred:', error);

    if (error instanceof ValidationException) {
        res.status(400).json({
            error: 'Validation failed',
            message: error.message,
            type: 'ValidationException'
        });
        return;
    }

    if (error instanceof ResourceNotFoundException) {
        res.status(404).json({
            error: 'Resource not found',
            message: error.message,
            type: 'ResourceNotFoundException'
        });
        return;
    }

    if (error instanceof DomainException) {
        res.status(400).json({
            error: 'Domain error',
            message: error.message,
            type: 'DomainException'
        });
        return;
    }

    // Generic error fallback
    res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred'
    });
};
