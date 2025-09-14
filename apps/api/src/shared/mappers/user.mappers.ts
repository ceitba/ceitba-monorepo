import { User } from '@/domain/user/models/user.model';
import { UserResponseDto } from '@/domain/user/dto/create-user.dto';

export class UserMappers {
    static userToResponseDto(user: User): UserResponseDto {
        return {
            id: user.id,
            email: user.email,
            file_number: user.file_number,
            name: user.name,
            career_id: user.career_id,
            plan: user.plan,
            role: user.role ? {
                branch: user.role.branch,
                role: user.role.role,
                start: user.role.start,
                end: user.role.end
            } : null
        };
    }

    static usersToResponseDto(users: User[]): UserResponseDto[] {
        return users.map(this.userToResponseDto);
    }
}
