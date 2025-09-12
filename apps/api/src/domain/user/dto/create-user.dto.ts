export interface CreateUserDto {
    email: string;
    file_number?: number;
    name?: string;
    career_id?: string;
    plan?: string;
}

export interface UpdateUserDto {
    email?: string;
    file_number?: number;
    name?: string;
    career_id?: string;
    plan?: string;
}

export interface UserResponseDto {
    id: string;
    email: string;
    file_number: number | null;
    name: string | null;
    career_id: string | null;
    plan: string | null;
    role: {
        branch: string;
        role: string;
        start: Date;
        end: Date | null;
    } | null;
}
