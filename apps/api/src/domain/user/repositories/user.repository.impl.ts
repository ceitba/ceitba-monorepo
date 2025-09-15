import { UserRepository } from "@/domain/user/interfaces/user.repository.interface";
import { UserRole } from "@/domain/user/models/user-role.model";
import { User } from "@/domain/user/models/user.model";
import { PrismaService } from "@/shared/database/prisma.service";

export class UserRepositoryImpl implements UserRepository {
    private readonly prisma: PrismaService;

    constructor(prisma: PrismaService) {
        this.prisma = prisma;
    }


    delete(id: string): Promise<void> {
        throw new Error("Method not implemented.");
    }

    async create(user: User): Promise<User> {
        // TODO: Replace RPC call 'create_user' with Prisma equivalent
        // Original RPC parameters: email_param, file_number_param, name_param, career_id_param, plan_param
        throw new Error('RPC call create_user needs to be replaced with Prisma query - please provide the equivalent query');
    }

    async update(user: User): Promise<User> {
        return null;
    //     const result = await this.prisma.user.update({
    //         where: { id: user.id },
    //         data: {
    //             email: user.email,
    //             fileNumber: user.file_number,
    //             name: user.name,
    //             careerId: user.career_id,
    //             plan: user.plan
    //         },
    //         include: {
    //             role: true
    //         }
    //     }).catch(err => {
    //         switch (err.code) {
    //             case 'P2025':
    //                 throw new UserNotFoundException(`User ${user.id} not found`, err);
    //             case 'P2002':
    //                 throw new UserAlreadyExistsException(`User with email ${user.email} already exists`, err);
    //             case 'P2003':
    //                 throw new ForeignKeyConstraintViolationException(`Invalid foreign key reference`, err);
    //             default:
    //                 throw new GenericDomainException('Failed to update user', err);
    //         }
    //     });

    //     const role = new UserRole(result.role.branch, result.role.role, result.role.start, result.role.end);
    //     return new User(result.id, result.email, result.fileNumber, result.name, result.careerId, result.plan, role);
    // }

    // async delete(id: string): Promise<void> {
    //     await this.prisma.user.delete({ 
    //         where: { id } 
    //     }).catch(err => {
    //         switch (err.code) {
    //             case 'P2025':
    //                 throw new UserNotFoundException(`User ${id} not found`, err);
    //             case 'P2003':
    //                 throw new ForeignKeyConstraintViolationException(
    //                     `Cannot delete user ${id}: it has related records`,
    //                     err
    //                 );
    //             default:
    //                 throw new GenericDomainException('Failed to delete user', err);
    //         }
    //     });
    }

    async findById(id: string): Promise<User | null> {
        return null;
        // const result = await this.prisma.user.findUnique({
        //     where: { id },
        //     include: {
        //         role: true
        //     }
        // });

        // if (!result) {
        //     return null;
        // }

        // const role = new UserRole(result.role.branch, result.role.role, result.role.start, result.role.end);
        // return new User(result.id, result.email, result.fileNumber, result.name, result.careerId, result.plan, role);
    }

    async findByEmail(email: string): Promise<User | null> {
        // TODO: Replace RPC call 'get_user_with_details' with Prisma equivalent
        // Original RPC parameters: email_param
        throw new Error('RPC call get_user_with_details needs to be replaced with Prisma query - please provide the equivalent query');
    }

    async findAll(): Promise<User[]> {
        // TODO: Replace RPC call 'get_all_users' with Prisma equivalent
        // Original RPC parameters: none
        throw new Error('RPC call get_all_users needs to be replaced with Prisma query - please provide the equivalent query');
    }

    async updateUserRole(email: string, role: UserRole): Promise<void> {
        // TODO: Replace RPC call 'update_user_role' with Prisma equivalent
        // Original RPC parameters: email_param, branch_param, role_param, start_param, end_param
        throw new Error('RPC call update_user_role needs to be replaced with Prisma query - please provide the equivalent query');
    }
}