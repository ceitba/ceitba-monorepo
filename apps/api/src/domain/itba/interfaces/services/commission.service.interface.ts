import { Commission } from "@/domain/itba/models/commission.model";

export interface CommissionService {
  getAllCommissions(): Promise<Commission[]>;
  getCommissionById(id: string): Promise<Commission | null>;
  getCommissionsBySubject(subjectCode: string): Promise<Commission[]>;
  getActiveCommissions(): Promise<Commission[]>;
  createCommission(commission: Commission): Promise<Commission>;
  updateCommission(commission: Commission): Promise<Commission>;
  deleteCommission(id: string): Promise<void>;
}
