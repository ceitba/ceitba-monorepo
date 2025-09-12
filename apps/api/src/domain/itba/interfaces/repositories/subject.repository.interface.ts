import { Subject } from '@/domain/itba/models/subject.model';

export interface SubjectRepository {
    findAll(): Promise<Subject[]>;
    findById(id: string): Promise<Subject | null>;
    findByName(name: string): Promise<Subject[]>;
    create(subject: Subject): Promise<Subject>;
    update(subject: Subject): Promise<Subject>;
    delete(id: string): Promise<void>;
    findByIds(ids: string[]): Promise<Subject[]>;
}
