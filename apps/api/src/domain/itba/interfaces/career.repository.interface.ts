import { Career } from '../models/career.model';

export interface CareerRepository {
    findAll(): Promise<Career[]>;
    findById(id: string): Promise<Career | null>;
    findByName(name: string): Promise<Career | null>;
    create(career: Career): Promise<Career>;
    update(career: Career): Promise<Career>;
    delete(id: string): Promise<void>;
    findCareersWithPlans(): Promise<Record<string, Career>>;
}
