import { User } from "@/domain/user/models/user.model";
import { UserRole } from "@/domain/user/models/user-role.model";

export interface UserRepository {
    create(user: User): Promise<User>;
    update(user: User): Promise<User>;
    delete(id: string): Promise<void>;
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    findAll(): Promise<User[]>;
    updateUserRole(email: string, role: UserRole): Promise<void>;
}