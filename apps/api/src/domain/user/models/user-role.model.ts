import { Branch, StaffType } from "../../../shared/types/ceitba.types";

export class UserRole {
    constructor(
        public readonly branch: Branch,
        public readonly role: StaffType,
        public readonly start: Date,
        public readonly end: Date | null
    ) {
        if (!branch.trim()) {
            throw new Error('Branch cannot be empty');
        }
        if (!role.trim()) {
            throw new Error('Role cannot be empty');
        }
        if (start > new Date()) {
            throw new Error('Start date cannot be in the future');
        }
    }
}