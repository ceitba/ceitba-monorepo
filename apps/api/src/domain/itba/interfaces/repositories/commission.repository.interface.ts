import { Commission } from '@/domain/itba/models/commission.model';

export interface CommissionRepository {
    findAll(): Promise<Commission[]>;
    findById(id: string): Promise<Commission | null>;
    findBySubjectCode(subjectCode: string): Promise<Commission[]>;
    findActiveCommissions(): Promise<Commission[]>;
    findByCommissionName(commissionName: string): Promise<Commission[]>;
    create(commission: Commission): Promise<Commission>;
    update(commission: Commission): Promise<Commission>;
    delete(id: string): Promise<void>;
    upsert(commission: Commission): Promise<Commission>;
    upsertMany(commissions: Commission[]): Promise<Commission[]>;
}
