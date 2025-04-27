import { UUID } from "crypto";

export interface Log {
    id: UUID;
    created_at: Date;
    benefit_id:string;
    user_id: UUID;
}

