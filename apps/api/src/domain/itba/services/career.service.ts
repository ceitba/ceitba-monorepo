import { Injectable, Inject } from '@nestjs/common';
import { Career } from '@/domain/itba/models/career.model';
import { CareerRepository } from '@/domain/itba/interfaces/repositories/career.repository.interface';
import { CareerServiceInterface } from '@/domain/itba/interfaces/services/career.service.interface';
import { CareerDto, CreateCareerDto } from '@/domain/itba/dto/career.dto';
import { CAREER_REPOSITORY } from '@/shared/constants/injection-tokens';

@Injectable()
export class CareerService implements CareerServiceInterface {
    constructor(@Inject(CAREER_REPOSITORY) private readonly careerRepository: CareerRepository) {}

    async getAllCareers(): Promise<Career[]> {
        return await this.careerRepository.findAll();
    }

    async getCareerById(id: string): Promise<Career | null> {
        return await this.careerRepository.findById(id);
    }

    async createCareer(createCareerDto: CreateCareerDto): Promise<Career> {
        const career = new Career(createCareerDto.id, createCareerDto.name, []);
        return await this.careerRepository.create(career);
    }

    async updateCareer(id: string, updateData: Partial<CreateCareerDto>): Promise<Career | null> {
        const existingCareer = await this.careerRepository.findById(id);
        if (!existingCareer) {
            return null;
        }

        const updatedCareer = new Career(
            id,
            updateData.name ?? existingCareer.name,
            existingCareer.plans
        );

        return await this.careerRepository.update(updatedCareer);
    }

    async deleteCareer(id: string): Promise<boolean> {
        const existingCareer = await this.careerRepository.findById(id);
        if (!existingCareer) {
            return false;
        }

        await this.careerRepository.delete(id);
        return true;
    }

    async getCareersWithPlans(): Promise<Record<string, Career>> {
        return await this.careerRepository.findCareersWithPlans();
    }

    async addPlanToCareer(careerId: string, planId: string): Promise<Career | null> {
        const existingCareer = await this.careerRepository.findById(careerId);
        if (!existingCareer) {
            return null;
        }

        const updatedCareer = existingCareer.addPlan(planId);
        return await this.careerRepository.update(updatedCareer);
    }

    async removePlanFromCareer(careerId: string, planId: string): Promise<Career | null> {
        const existingCareer = await this.careerRepository.findById(careerId);
        if (!existingCareer) {
            return null;
        }

        const updatedCareer = existingCareer.removePlan(planId);
        return await this.careerRepository.update(updatedCareer);
    }
}
