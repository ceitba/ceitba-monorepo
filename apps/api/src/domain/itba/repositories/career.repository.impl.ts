import { Career } from '@/domain/itba/models/career.model';
import { CareerRepository } from '@/domain/itba/interfaces/repositories/career.repository.interface';
import { CareerAlreadyExistsException, CareerNotFoundException, ForeignKeyConstraintViolationException } from '@/domain/itba/exceptions/itba.exceptions';
import { GenericDomainException } from '@/shared/exceptions';
import { PrismaService } from '@/shared/database/prisma.service';

export class CareerRepositoryImpl implements CareerRepository {
    
    private readonly prisma: PrismaService;

    constructor(prisma: PrismaService) {
        this.prisma = prisma;
    }

    async findAll(): Promise<Career[]> {
         const result = await this.prisma.career.findMany({
            select: { id: true, name: true }, 
            orderBy: { id: 'asc' },
            });;

         return result.map(r => new Career(r.id, r.name, []));
    }

    async findById(id: string): Promise<Career | null> {
        const result = await this.prisma.career.findUnique({
            where: {id},
            select: {id: true, name: true}
        });

        if (!result) {
            return null;
        }

        return new Career(result.id, result.name, []);
    }

    async findByName(name: string): Promise<Career | null> {
        const result = await this.prisma.career.findFirst({
            where: { name },
            select: { id: true, name: true }
        });

        if (!result) {
            return null;
        }

        return new Career(result.id, result.name, []);
    }

    async create(career: Career): Promise<Career> {
            const row = await this.prisma.career.create({
                data: {
                id: career.id,
                name: career.name,
        },
            select: { id: true, name: true },
        }).catch(err => {
            switch (err.code) {
                case 'P2002':
                    throw new CareerAlreadyExistsException(career.id, err);
                default:
                    throw new GenericDomainException(`Failed to create career`, err);
            }
        });
        return new Career(row.id, row.name, career.plans);
    }

   async update(career: Career): Promise<Career> {
        const result = await this.prisma.career.update({
        where: { id: career.id },
        data:  { name: career.name },
        select:{ id: true, name: true },
        }).catch(err => {
            switch (err.code) {
                case 'P2025': 
                    throw new CareerNotFoundException(`Career ${career.id} not found`, err);
                case 'P2002':
                    throw new CareerAlreadyExistsException(career.id, err);
                default:
                    throw new GenericDomainException('Failed to update career', err);
            }
        });
        return new Career(result.id, result.name, career.plans); 
    }

    async delete(id: string): Promise<void> {
        await this.prisma.career.delete({ where: { id } }).catch(err => {
            switch (err.code) {
                case 'P2025': 
                    throw new CareerNotFoundException(`Career ${id} not found`, err);
                case 'P2003':
                    throw new ForeignKeyConstraintViolationException(
                        `Cannot delete career ${id}: it has related records (e.g., plans).`,
                        err
                    );
                default:
                    throw new GenericDomainException('Failed to delete career', err);
            }
        });
    }

    
    async findCareersWithPlans(): Promise<Record<string, Career>> {
        const result = await this.prisma.career.findMany({
            include: { plans: { select: { id: true } } },
            orderBy: { id: 'asc' },
        });

        const entries = result.map(r => {
            const planIds = r.plans.map(p => p.id);
            return [r.id, new Career(r.id, r.name, planIds)] as const;
        });

        return Object.fromEntries(entries);
    }
}
