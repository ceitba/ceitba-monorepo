import { Career } from '@/domain/itba/models/career.model';
import { CareerRepository } from '@/domain/itba/interfaces/repositories/career.repository.interface';
import { DatabaseClient, DatabaseFactory, DatabaseErrorCode } from '@/shared/database';
import { CareerAlreadyExistsException } from '@/domain/itba/exceptions/itba.exceptions';
import { GenericDomainException } from '@/shared/exceptions';
import { PrismaService } from '@/shared/database/prisma.service';

export class CareerRepositoryImpl implements CareerRepository {
    
    private readonly prisma: PrismaService;

    constructor(prisma: PrismaService) {
        this.prisma = prisma;
    }

    async findAll(): Promise<Career[]> {
        const result = await this.db.select<any>('career');

        if (result.error) {
            throw new Error(`Error fetching careers: ${result.error.message}`);
        }

        return result.data!.map(career => new Career(career.id, career.name, []));
    }

    async findById(id: string): Promise<Career | null> {
        const result = await this.db.selectOne<any>('career', {
            eq: { id }
        });

        if (result.error) {
            if (result.error.isNotFound()) {
                return null;
            }
            throw new Error(`Error fetching career: ${result.error.message}`);
        }

        if (!result.data) {
            return null;
        }

        return new Career(result.data.id, result.data.name, []);
    }

    async findByName(name: string): Promise<Career | null> {
        const result = await this.db.selectOne<any>('career', {
            eq: { name }
        });

        if (result.error) {
            if (result.error.isNotFound()) {
                return null;
            }
            throw new Error(`Error fetching career: ${result.error.message}`);
        }

        if (!result.data) {
            return null;
        }

        return new Career(result.data.id, result.data.name, []);
    }

    async create(career: Career): Promise<Career> {
        const result = await this.db.insert<any>('career', {
            data: {
                id: career.id,
                name: career.name
            }
        });

        if (result.error) {
            if (result.error.is(DatabaseErrorCode.UNIQUE_VIOLATION)) {
                throw new CareerAlreadyExistsException(career.id, result.error);
            }
            
            throw new GenericDomainException(
                `Failed to create career: ${result.error.message}`,
                result.error
            );
        }

        const data = Array.isArray(result.data) ? result.data[0] : result.data;
        return new Career(data.id, data.name, career.plans);
    }

    async update(career: Career): Promise<Career> {
        const result = await this.db.update<any>('career', {
            data: {
                name: career.name
            },
            where: { id: career.id }
        });

        if (result.error) {
            throw new Error(`Error updating career: ${result.error.message}`);
        }

        const data = Array.isArray(result.data) ? result.data[0] : result.data;
        return new Career(data.id, data.name, career.plans);
    }

    async delete(id: string): Promise<void> {
        const result = await this.db.delete('career', {
            where: { id }
        });

        if (result.error) {
            throw new Error(`Error deleting career: ${result.error.message}`);
        }
    }

    async findCareersWithPlans(): Promise<Record<string, Career>> {
        const result = await this.db.select<any>('plan', {
            select: 'id, career (id, name)'
        });

        if (result.error) {
            throw new Error(`Error fetching career plans: ${result.error.message}`);
        }

        const careersMap = new Map<string, Career>();

        for (const plan of result.data!) {
            if (!careersMap.has(plan.career.id)) {
                careersMap.set(plan.career.id, new Career(
                    plan.career.id,
                    plan.career.name,
                    []
                ));
            }
            const career = careersMap.get(plan.career.id)!;
            const updatedCareer = career.addPlan(plan.id);
            careersMap.set(plan.career.id, updatedCareer);
        }

        return Object.fromEntries(careersMap);
    }
}
