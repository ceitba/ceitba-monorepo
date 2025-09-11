import { Career } from '../models/career.model';
import { CareerRepository } from '../interfaces/career.repository.interface';
import { CareerDto, CreateCareerDto } from '../dto/career.dto';

export class CareerService {
    constructor(private readonly careerRepository: CareerRepository) {}

    async getAllCareers(): Promise<CareerDto[]> {
        const careers = await this.careerRepository.findAll();
        return careers.map(this.mapToDto);
    }

    async getCareerById(id: string): Promise<CareerDto | null> {
        const career = await this.careerRepository.findById(id);
        return career ? this.mapToDto(career) : null;
    }

    async createCareer(createCareerDto: CreateCareerDto): Promise<CareerDto> {
        const career = new Career(createCareerDto.id, createCareerDto.name, []);
        const savedCareer = await this.careerRepository.create(career);
        return this.mapToDto(savedCareer);
    }

    async updateCareer(id: string, updateData: Partial<CreateCareerDto>): Promise<CareerDto | null> {
        const existingCareer = await this.careerRepository.findById(id);
        if (!existingCareer) {
            return null;
        }

        const updatedCareer = new Career(
            id,
            updateData.name ?? existingCareer.name,
            existingCareer.plans
        );

        const savedCareer = await this.careerRepository.update(updatedCareer);
        return this.mapToDto(savedCareer);
    }

    async deleteCareer(id: string): Promise<boolean> {
        const existingCareer = await this.careerRepository.findById(id);
        if (!existingCareer) {
            return false;
        }

        await this.careerRepository.delete(id);
        return true;
    }

    async getCareersWithPlans(): Promise<Record<string, CareerDto>> {
        const careersMap = await this.careerRepository.findCareersWithPlans();
        const result: Record<string, CareerDto> = {};
        
        for (const [key, career] of Object.entries(careersMap)) {
            result[key] = this.mapToDto(career);
        }
        
        return result;
    }

    async addPlanToCareer(careerId: string, planId: string): Promise<CareerDto | null> {
        const existingCareer = await this.careerRepository.findById(careerId);
        if (!existingCareer) {
            return null;
        }

        const updatedCareer = existingCareer.addPlan(planId);
        const savedCareer = await this.careerRepository.update(updatedCareer);
        return this.mapToDto(savedCareer);
    }

    async removePlanFromCareer(careerId: string, planId: string): Promise<CareerDto | null> {
        const existingCareer = await this.careerRepository.findById(careerId);
        if (!existingCareer) {
            return null;
        }

        const updatedCareer = existingCareer.removePlan(planId);
        const savedCareer = await this.careerRepository.update(updatedCareer);
        return this.mapToDto(savedCareer);
    }

    private mapToDto(career: Career): CareerDto {
        return {
            id: career.id,
            name: career.name,
            plans: [...career.plans]
        };
    }
}
