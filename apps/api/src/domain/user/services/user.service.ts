import { Injectable, Inject } from '@nestjs/common';
import { User } from '@/domain/user/models/user.model';
import { UserRole } from '@/domain/user/models/user-role.model';
import { UserRepository } from '@/domain/user/interfaces/user.repository.interface';
import { UserServiceInterface } from '@/domain/user/interfaces/user.service.interface';
import { CreateUserDto, UpdateUserDto } from '@/domain/user/dto/create-user.dto';
import { UUID } from 'crypto';
import { USER_REPOSITORY } from '@/shared/constants/injection-tokens';

@Injectable()
export class UserService implements UserServiceInterface {
    constructor(@Inject(USER_REPOSITORY) private readonly userRepository: UserRepository) {}

    async createUser(createUserDto: CreateUserDto): Promise<User> {
        // Create a new User domain object
        const user = new User(
            crypto.randomUUID() as UUID, // Generate a new UUID
            createUserDto.email,
            createUserDto.file_number ?? null,
            createUserDto.name ?? null,
            createUserDto.career_id ?? null,
            createUserDto.plan ?? null,
            null // role starts as null
        );

        return await this.userRepository.create(user);
    }

    async updateUser(id: string, updateUserDto: UpdateUserDto): Promise<User | null> {
        const existingUser = await this.userRepository.findById(id);
        if (!existingUser) {
            return null;
        }

        // Create updated user with new values or existing ones
        const updatedUser = new User(
            existingUser.id,
            updateUserDto.email ?? existingUser.email,
            updateUserDto.file_number ?? existingUser.file_number,
            updateUserDto.name ?? existingUser.name,
            updateUserDto.career_id ?? existingUser.career_id,
            updateUserDto.plan ?? existingUser.plan,
            existingUser.role
        );

        return await this.userRepository.update(updatedUser);
    }

    async deleteUser(id: string): Promise<boolean> {
        const existingUser = await this.userRepository.findById(id);
        if (!existingUser) {
            return false;
        }

        await this.userRepository.delete(id);
        return true;
    }

    async getUserById(id: string): Promise<User | null> {
        return await this.userRepository.findById(id);
    }

    async getUserByEmail(email: string): Promise<User | null> {
        return await this.userRepository.findByEmail(email);
    }

    async getAllUsers(): Promise<User[]> {
        return await this.userRepository.findAll();
    }

    async updateUserRole(email: string, role: UserRole): Promise<void> {
        await this.userRepository.updateUserRole(email, role);
    }
}
