import { Subject } from '../models/subject.model';
import { SubjectRepository } from '../interfaces/subject.repository.interface';
import { DatabaseClient, DatabaseFactory, DatabaseErrorCode } from '../../../shared/database';

export class SubjectRepositoryImpl implements SubjectRepository {
    private readonly db: DatabaseClient;

    constructor(db?: DatabaseClient) {
        this.db = db || DatabaseFactory.getInstance();
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
