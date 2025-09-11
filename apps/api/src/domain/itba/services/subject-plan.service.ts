import { SubjectPlan } from '../models/subject-plan.model';
import { Subject } from '../models/subject.model';
import { SubjectPlanRepository } from '../interfaces/subject-plan.repository.interface';
import { SubjectRepository } from '../interfaces/subject.repository.interface';
import { ItbaApiService } from '../interfaces/itba-api.service.interface';
import { SubjectPlanDto, CreateSubjectPlanDto } from '../dto/subjectPlan.dto';

export class SubjectPlanService {
    constructor(
        private readonly subjectPlanRepository: SubjectPlanRepository,
        private readonly subjectRepository: SubjectRepository,
        private readonly itbaApiService: ItbaApiService
    ) {}

    async getSubjectsByPlan(planId: string): Promise<SubjectPlanDto[]> {
        const subjectPlans = await this.subjectPlanRepository.findByPlanId(planId);
        return subjectPlans.map(this.mapToDto);
    }

    async getSubjectsByPlanFromApi(planId: string): Promise<SubjectPlanDto[]> {
        const subjectPlans = await this.itbaApiService.getSubjectsByPlan(planId);
        return subjectPlans.map(this.mapToDto);
    }

    async getSubjectPlansBySubject(subjectId: string): Promise<SubjectPlanDto[]> {
        const subjectPlans = await this.subjectPlanRepository.findBySubjectId(subjectId);
        return subjectPlans.map(this.mapToDto);
    }

    async getSubjectPlan(planId: string, subjectId: string): Promise<SubjectPlanDto | null> {
        const subjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(planId, subjectId);
        return subjectPlan ? this.mapToDto(subjectPlan) : null;
    }

    async createSubjectPlan(createSubjectPlanDto: CreateSubjectPlanDto): Promise<SubjectPlanDto> {
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

        const savedSubjectPlan = await this.subjectPlanRepository.create(subjectPlan);
        return this.mapToDto(savedSubjectPlan);
    }

    async updateSubjectPlan(
        planId: string,
        subjectId: string,
        updateData: Partial<CreateSubjectPlanDto>
    ): Promise<SubjectPlanDto | null> {
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

        const savedSubjectPlan = await this.subjectPlanRepository.update(updatedSubjectPlan);
        return this.mapToDto(savedSubjectPlan);
    }

    async deleteSubjectPlan(planId: string, subjectId: string): Promise<boolean> {
        const existingSubjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(planId, subjectId);
        if (!existingSubjectPlan) {
            return false;
        }

        await this.subjectPlanRepository.delete(planId, subjectId);
        return true;
    }

    async getSubjectsBySection(planId: string, section: string): Promise<SubjectPlanDto[]> {
        const subjectPlans = await this.subjectPlanRepository.findBySection(planId, section);
        return subjectPlans.map(this.mapToDto);
    }

    async getElectiveSubjects(planId: string): Promise<SubjectPlanDto[]> {
        const subjectPlans = await this.subjectPlanRepository.findElectives(planId);
        return subjectPlans.map(this.mapToDto);
    }

    async getSubjectsByYear(planId: string, year: number): Promise<SubjectPlanDto[]> {
        const subjectPlans = await this.subjectPlanRepository.findByYear(planId, year);
        return subjectPlans.map(this.mapToDto);
    }

    async getSubjectsBySemester(planId: string, year: number, semester: number): Promise<SubjectPlanDto[]> {
        const subjectPlans = await this.subjectPlanRepository.findBySemester(planId, year, semester);
        return subjectPlans.map(this.mapToDto);
    }

    async getSubjectDependencies(planId: string, subjectId: string): Promise<SubjectPlanDto[]> {
        const subjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(planId, subjectId);
        if (!subjectPlan || !subjectPlan.hasDependencies()) {
            return [];
        }

        const dependencies: SubjectPlanDto[] = [];
        for (const depId of subjectPlan.dependencies) {
            const depSubjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(planId, depId);
            if (depSubjectPlan) {
                dependencies.push(this.mapToDto(depSubjectPlan));
            }
        }

        return dependencies;
    }

    private mapToDto(subjectPlan: SubjectPlan): SubjectPlanDto {
        return {
            subjectId: subjectPlan.subjectId,
            planId: subjectPlan.planId,
            section: subjectPlan.section,
            year: subjectPlan.year,
            semester: subjectPlan.semester,
            dependencies: [...subjectPlan.dependencies],
            creditsRequired: subjectPlan.creditsRequired,
            subject: {
                id: subjectPlan.subject.id,
                name: subjectPlan.subject.name,
                credits: subjectPlan.subject.credits
            }
        };
    }
}
