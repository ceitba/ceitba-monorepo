import { Injectable, Inject } from "@nestjs/common";
import { Commission } from "@/domain/itba/models/commission.model";
import { CommissionService } from "@/domain/itba/interfaces/services/commission.service.interface";
import { CommissionRepository } from "@/domain/itba/interfaces/repositories/commission.repository.interface";
import { COMMISSION_REPOSITORY } from "@/shared/constants/injection-tokens";

@Injectable()
export class CommissionServiceImpl implements CommissionService {
  constructor(
    @Inject(COMMISSION_REPOSITORY)
    private readonly commissionRepository: CommissionRepository,
  ) {}

  async getAllCommissions(): Promise<Commission[]> {
    return await this.commissionRepository.findAll();
  }

  async getCommissionById(id: string): Promise<Commission | null> {
    return await this.commissionRepository.findById(id);
  }

  async getCommissionsBySubject(subjectCode: string): Promise<Commission[]> {
    return await this.commissionRepository.findBySubjectCode(subjectCode);
  }

  async getActiveCommissions(): Promise<Commission[]> {
    return await this.commissionRepository.findActiveCommissions();
  }

  async createCommission(commission: Commission): Promise<Commission> {
    return await this.commissionRepository.create(commission);
  }

  async updateCommission(commission: Commission): Promise<Commission> {
    return await this.commissionRepository.update(commission);
  }

  async deleteCommission(id: string): Promise<void> {
    return await this.commissionRepository.delete(id);
  }
}
