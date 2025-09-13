import { z } from "zod";

export const CreateUserSchema = z.object({
    email: z.string().email(),
    file_number: z.number().optional(),
    name: z.string().optional(),
    career_id: z.string().optional(),
    plan: z.string().optional(),
});

export type CreateUserRequest = z.infer<typeof CreateUserSchema>;