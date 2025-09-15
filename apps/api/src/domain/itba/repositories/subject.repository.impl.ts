import { Subject } from '@/domain/itba/models/subject.model';
import { SubjectRepository } from '@/domain/itba/interfaces/repositories/subject.repository.interface';
import { DatabaseClient, DatabaseFactory, DatabaseErrorCode } from '@/shared/database';
import { PrismaService } from '@/shared/database/prisma.service';

export class SubjectRepositoryImpl implements SubjectRepository {
    private readonly prisma: PrismaService;

    constructor(prisma: PrismaService) {
        this.prisma = prisma;
    }
    
    async findAll(): Promise<Subject[]> {
        const result = await this.db.select<any>('subject');

        if (result.error) {
            throw new Error(`Error fetching subjects: ${result.error.message}`);
        }

        return result.data!.map(subject => new Subject(subject.id, subject.name, subject.credits));
    }

    async findById(id: string): Promise<Subject | null> {
        const result = await this.db.selectOne<any>('subject', {
            eq: { id }
        });

        if (result.error) {
            if (result.error.isNotFound()) {
                return null;
            }
            throw new Error(`Error fetching subject: ${result.error.message}`);
        }

        if (!result.data) {
            return null;
        }

        return new Subject(result.data.id, result.data.name, result.data.credits);
    }

    async findByName(name: string): Promise<Subject[]> {
        const result = await this.db.select<any>('subject', {
            ilike: { name: `%${name}%` }
        });

        if (result.error) {
            throw new Error(`Error fetching subjects by name: ${result.error.message}`);
        }

        return result.data!.map(subject => new Subject(subject.id, subject.name, subject.credits));
    }

    async create(subject: Subject): Promise<Subject> {
        const result = await this.db.insert<any>('subject', {
            data: {
                id: subject.id,
                name: subject.name,
                credits: subject.credits
            }
        });

        if (result.error) {
            throw new Error(`Error creating subject: ${result.error.message}`);
        }

        const data = Array.isArray(result.data) ? result.data[0] : result.data;
        return new Subject(data.id, data.name, data.credits);
    }

    async update(subject: Subject): Promise<Subject> {
        const result = await this.db.update<any>('subject', {
            data: {
                name: subject.name,
                credits: subject.credits
            },
            where: { id: subject.id }
        });

        if (result.error) {
            throw new Error(`Error updating subject: ${result.error.message}`);
        }

        const data = Array.isArray(result.data) ? result.data[0] : result.data;
        return new Subject(data.id, data.name, data.credits);
    }

    async delete(id: string): Promise<void> {
        const result = await this.db.delete('subject', {
            where: { id }
        });

        if (result.error) {
            throw new Error(`Error deleting subject: ${result.error.message}`);
        }
    }

    async findByIds(ids: string[]): Promise<Subject[]> {
        if (ids.length === 0) {
            return [];
        }

        const result = await this.db.select<any>('subject', {
            in: { id: ids }
        });

        if (result.error) {
            throw new Error(`Error fetching subjects by IDs: ${result.error.message}`);
        }

        return result.data!.map(subject => new Subject(subject.id, subject.name, subject.credits));
    }
}
