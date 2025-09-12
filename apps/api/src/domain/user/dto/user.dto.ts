import { UUID } from "crypto";
import { Branch, StaffType } from "../../../shared/types/ceitba.types";

export interface UserDTO {
    id: UUID;
    email: string;
    file_number: number;
    name: string;
    career_id: string;
    plan: string;
    role: {
        branch: Branch;
        role: StaffType;
        start: Date;
        end: Date;
    };
}