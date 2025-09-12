import { UUID } from "crypto";
import { UserRole } from "./user-role.model";

// TODO: Model each attribute correctly (values, types, etc)
// TODO: Make email model, file_number model, name model, career_id model, plan model
export class User {
    constructor(
        public readonly id: UUID,
        public readonly email: string,
        public readonly file_number: number | null,
        public readonly name: string | null,
        public readonly career_id: string | null,
        public readonly plan: string | null,
        public readonly role: UserRole | null
    )
    {
        if (!email.trim()) {
            throw new Error('Email cannot be empty');
        }
        if (file_number !== null && file_number < 0) {
            throw new Error('File number must be positive');
        }
    }
}