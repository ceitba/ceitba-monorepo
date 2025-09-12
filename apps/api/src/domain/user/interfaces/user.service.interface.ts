import { User } from '@/domain/user/models/user.model';
import { UserRole } from '@/domain/user/models/user-role.model';
import { CreateUserDto, UpdateUserDto } from '@/domain/user/dto/create-user.dto';

export interface UserServiceInterface {
    createUser(createUserDto: CreateUserDto): Promise<User>;
    updateUser(id: string, updateUserDto: UpdateUserDto): Promise<User | null>;
    deleteUser(id: string): Promise<boolean>;
    getUserById(id: string): Promise<User | null>;
    getUserByEmail(email: string): Promise<User | null>;
    getAllUsers(): Promise<User[]>;
    updateUserRole(email: string, role: UserRole): Promise<void>;
}
