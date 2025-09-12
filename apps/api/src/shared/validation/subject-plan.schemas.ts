import { z } from 'zod';

export const SubjectPlanQuerySchema = z.object({
    year: z.string().optional().transform((val) => val ? parseInt(val, 10) : null),
    semester: z.string().optional().transform((val) => val ? parseInt(val, 10) : null),
    section: z.string().optional(),
    type: z.enum(['elective']).optional(),
    planId: z.string().optional()
});

export const CreateSubjectPlanSchema = z.object({
    subjectId: z.string().min(1, 'Subject ID is required'),
    section: z.string().min(1, 'Section is required'),
    year: z.number().int().min(1).max(10).nullable().optional(),
    semester: z.number().int().min(1).max(2).nullable().optional(),
    dependencies: z.array(z.string()).default([]),
    creditsRequired: z.number().int().min(0).nullable().optional()
});

export const UpdateSubjectPlanSchema = z.object({
    section: z.string().min(1).optional(),
    year: z.number().int().min(1).max(10).nullable().optional(),
    semester: z.number().int().min(1).max(2).nullable().optional(),
    dependencies: z.array(z.string()).optional(),
    creditsRequired: z.number().int().min(0).nullable().optional()
});

export const SubjectPlanParamsSchema = z.object({
    planId: z.string().min(1, 'Plan ID is required'),
    subjectId: z.string().min(1, 'Subject ID is required').optional()
});

export const ClassroomQuerySchema = z.object({
    status: z.enum(['occupied', 'available']).optional(),
    current_semester: z.string().optional().transform((val) => val === 'true').default('true')
});

export const ClassroomConflictSchema = z.object({
    classroom: z.string().min(1, 'Classroom name is required'),
    building: z.string().min(1, 'Building is required'),
    day: z.string().min(1, 'Day is required'),
    hourFrom: z.string().min(1, 'Hour from is required'),
    hourTo: z.string().min(1, 'Hour to is required')
});

export const CreateCareerSchema = z.object({
    id: z.string().min(1, 'Career ID is required'),
    name: z.string().min(1, 'Career name is required')
});

export const UpdateCareerSchema = z.object({
    name: z.string().min(1, 'Career name is required').optional()
});

export type SubjectPlanQuery = z.infer<typeof SubjectPlanQuerySchema>;
export type CreateSubjectPlanRequest = z.infer<typeof CreateSubjectPlanSchema>;
export type UpdateSubjectPlanRequest = z.infer<typeof UpdateSubjectPlanSchema>;
export type SubjectPlanParams = z.infer<typeof SubjectPlanParamsSchema>;
export type ClassroomQuery = z.infer<typeof ClassroomQuerySchema>;
export type ClassroomConflictRequest = z.infer<typeof ClassroomConflictSchema>;
export type CreateCareerRequest = z.infer<typeof CreateCareerSchema>;
export type UpdateCareerRequest = z.infer<typeof UpdateCareerSchema>;
