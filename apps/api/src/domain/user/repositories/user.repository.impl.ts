import { DatabaseClient, DatabaseFactory } from "@/shared/database";
import { UserDTO } from "@/domain/user/dto/user.dto";
import { UserRepository } from "@/domain/user/interfaces/user.repository.interface";
import { UserRole } from "@/domain/user/models/user-role.model";
import { User } from "@/domain/user/models/user.model";

export class UserRepositoryImpl implements UserRepository {
    private readonly db: DatabaseClient;

    constructor(db?: DatabaseClient) {
        this.db = db || DatabaseFactory.getInstance();
    }

    async create(user: User): Promise<User> {
        const result = await this.db.rpc('create_user', {
            email_param: user.email,
            file_number_param: user.file_number,
            name_param: user.name,
            career_id_param: user.career_id,
            plan_param: user.plan
        });

        if (result.error) {
            throw new Error(`Error creating user: ${result.error.message}`);
        }

        const data = result.data as UserDTO;
        return new User(data.id, data.email, data.file_number, data.name, data.career_id, data.plan, data.role);
        
    }

    async update(user: User): Promise<User> {
        // TODO: Implement
        throw new Error('Not implemented');
    }

    async delete(id: string): Promise<void> {
        // TODO: Implement
        throw new Error('Not implemented');
    }

    async findById(id: string): Promise<User | null> {
        // TODO: Implement
        throw new Error('Not implemented');
    }

    async findByEmail(email: string): Promise<User | null> {
        const result = await this.db.rpc('get_user_with_details', {
            email_param: email
        });
        if (result.error) {
            throw new Error(`Error finding user by email: ${result.error.message}`);
        }

        const data = result.data as UserDTO;
        return new User(data.id, data.email, data.file_number, data.name, data.career_id, data.plan, data.role);
    }

    async findAll(): Promise<User[]> {
        const result = await this.db.rpc('get_all_users');
        if (result.error) {
            throw new Error(`Error finding all users: ${result.error.message}`);
        }

        const data = result.data as Array<UserDTO>;

        return data.map(user => {
            const role = new UserRole(user.role.branch, user.role.role, user.role.start, user.role.end);
            return new User(user.id, user.email, user.file_number, user.name, user.career_id, user.plan, role);
        });
    }

    async updateUserRole(email: string, role: UserRole): Promise<void> {
        const result = await this.db.rpc('update_user_role', {
            email_param: email,
            branch_param: role.branch,
            role_param: role.role,
            start_param: role.start,
            end_param: role.end
        });

        if (result.error) {
            throw new Error(`Error updating user role: ${result.error.message}`);
        }
    }
}