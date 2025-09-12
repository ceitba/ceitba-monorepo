import { SubjectPlan } from '@/domain/itba/models/subject-plan.model';
import { SubjectPlanRepository } from '@/domain/itba/interfaces/repositories/subject-plan.repository.interface';
import { SubjectRepository } from '@/domain/itba/interfaces/repositories/subject.repository.interface';
import { ItbaApiService } from '@/domain/itba/interfaces/repositories/itba-api.service.interface';
import { SubjectPlanServiceInterface } from '@/domain/itba/interfaces/services/subject-plan.service.interface';
import { SubjectPlanDto, CreateSubjectPlanDto } from '@/domain/itba/dto/subjectPlan.dto';

export class SubjectPlanService implements SubjectPlanServiceInterface {
    constructor(
        private readonly subjectPlanRepository: SubjectPlanRepository,
        private readonly subjectRepository: SubjectRepository,
        private readonly itbaApiService: ItbaApiService
    ) {}

    async getSubjectsByPlan(planId: string): Promise<SubjectPlan[]> {
        return await this.subjectPlanRepository.findByPlanId(planId);
    }

    async getSubjectsByPlanFromApi(planId: string): Promise<SubjectPlan[]> {
        return await this.itbaApiService.getSubjectsByPlan(planId);
    }

    async getSubjectPlansBySubject(subjectId: string): Promise<SubjectPlan[]> {
        return await this.subjectPlanRepository.findBySubjectId(subjectId);
    }

    async getSubjectPlan(planId: string, subjectId: string): Promise<SubjectPlan | null> {
        return await this.subjectPlanRepository.findByPlanAndSubject(planId, subjectId);
    }

    async createSubjectPlan(createSubjectPlanDto: CreateSubjectPlanDto): Promise<SubjectPlan> {
        // Get the subject information
        const subject = await this.subjectRepository.findById(createSubjectPlanDto.subjectId);
        if (!subject) {
            throw new Error(`Subject with ID ${createSubjectPlanDto.subjectId} not found`);
        }

        const subjectPlan = new SubjectPlan(
            createSubjectPlanDto.subjectId,
            createSubjectPlanDto.planId,
            createSubjectPlanDto.section,
            createSubjectPlanDto.year,
            createSubjectPlanDto.semester,
            createSubjectPlanDto.dependencies,
            createSubjectPlanDto.creditsRequired,
            subject
        );

        return await this.subjectPlanRepository.create(subjectPlan);
    }

    async updateSubjectPlan(
        planId: string,
        subjectId: string,
        updateData: Partial<CreateSubjectPlanDto>
    ): Promise<SubjectPlan | null> {
        const existingSubjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(planId, subjectId);
        if (!existingSubjectPlan) {
            return null;
        }

        const updatedSubjectPlan = new SubjectPlan(
            subjectId,
            planId,
            updateData.section ?? existingSubjectPlan.section,
            updateData.year ?? existingSubjectPlan.year,
            updateData.semester ?? existingSubjectPlan.semester,
            updateData.dependencies ?? existingSubjectPlan.dependencies,
            updateData.creditsRequired ?? existingSubjectPlan.creditsRequired,
            existingSubjectPlan.subject
        );

        return await this.subjectPlanRepository.update(updatedSubjectPlan);
    }

    async deleteSubjectPlan(planId: string, subjectId: string): Promise<boolean> {
        const existingSubjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(planId, subjectId);
        if (!existingSubjectPlan) {
            return false;
        }

        await this.subjectPlanRepository.delete(planId, subjectId);
        return true;
    }

    async getSubjectsBySection(planId: string, section: string): Promise<SubjectPlan[]> {
        return await this.subjectPlanRepository.findBySection(planId, section);
    }

    async getElectiveSubjects(planId: string): Promise<SubjectPlan[]> {
        return await this.subjectPlanRepository.findElectives(planId);
    }

    async getSubjectsByYear(planId: string, year: number): Promise<SubjectPlan[]> {
        return await this.subjectPlanRepository.findByYear(planId, year);
    }

    async getSubjectsBySemester(planId: string, year: number, semester: number): Promise<SubjectPlan[]> {
        return await this.subjectPlanRepository.findBySemester(planId, year, semester);
    }

    async getSubjectDependencies(planId: string, subjectId: string): Promise<SubjectPlan[]> {
        const subjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(planId, subjectId);
        if (!subjectPlan || !subjectPlan.hasDependencies()) {
            return [];
        }

        const dependencies: SubjectPlan[] = [];
        for (const depId of subjectPlan.dependencies) {
            const depSubjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(planId, depId);
            if (depSubjectPlan) {
                dependencies.push(depSubjectPlan);
            }
        }

        return dependencies;
    }
}
