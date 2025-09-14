import { Injectable, Inject } from '@nestjs/common';
import { SubjectPlan } from '@/domain/itba/models/subject-plan.model';
import { SubjectPlanRepository } from '@/domain/itba/interfaces/repositories/subject-plan.repository.interface';
import { SubjectRepository } from '@/domain/itba/interfaces/repositories/subject.repository.interface';
import { ItbaApiService } from '@/domain/itba/interfaces/repositories/itba-api.service.interface';
import { SubjectPlanServiceInterface } from '@/domain/itba/interfaces/services/subject-plan.service.interface';
import { SubjectPlanDto, CreateSubjectPlanDto } from '@/domain/itba/dto/subjectPlan.dto';
import { ValidationException, ResourceNotFoundException } from '@/shared/exceptions/domain.exceptions';
import { SUBJECT_PLAN_REPOSITORY, SUBJECT_REPOSITORY, ITBA_API_SERVICE } from '@/shared/constants/injection-tokens';

@Injectable()
export class SubjectPlanService implements SubjectPlanServiceInterface {
    constructor(
        @Inject(SUBJECT_PLAN_REPOSITORY) private readonly subjectPlanRepository: SubjectPlanRepository,
        @Inject(SUBJECT_REPOSITORY) private readonly subjectRepository: SubjectRepository,
        @Inject(ITBA_API_SERVICE) private readonly itbaApiService: ItbaApiService
    ) {}

    async getSubjectsByPlan(planId: string): Promise<SubjectPlan[]> {
        return await this.subjectPlanRepository.findByPlanId(planId);
    }

    async getSubjectsByPlanWithFilters(
        planId: string,
        filters: {
            year?: number;
            semester?: number;
            section?: string;
            type?: 'elective';
        }
    ): Promise<SubjectPlan[]> {
        if (filters.year !== undefined && filters.semester !== undefined) {
            return await this.getSubjectsBySemester(planId, filters.year, filters.semester);
        }
        
        if (filters.year !== undefined) {
            return await this.getSubjectsByYear(planId, filters.year);
        }
        
        if (filters.section) {
            return await this.getSubjectsBySection(planId, filters.section);
        }
        
        if (filters.type === 'elective') {
            return await this.getElectiveSubjects(planId);
        }
        
        return await this.getSubjectsByPlan(planId);
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
        const subject = await this.subjectRepository.findById(createSubjectPlanDto.subjectId);
        if (!subject) {
            throw new ResourceNotFoundException('Subject', createSubjectPlanDto.subjectId);
        }

        const existingSubjectPlan = await this.subjectPlanRepository.findByPlanAndSubject(
            createSubjectPlanDto.planId, 
            createSubjectPlanDto.subjectId
        );
        if (existingSubjectPlan) {
            throw new ValidationException(
                'subjectPlan', 
                `${createSubjectPlanDto.planId}-${createSubjectPlanDto.subjectId}`, 
                'Subject plan already exists for this plan and subject combination'
            );
        }

        const dependencies = createSubjectPlanDto.dependencies || [];

        const subjectPlan = new SubjectPlan(
            createSubjectPlanDto.subjectId,
            createSubjectPlanDto.planId,
            createSubjectPlanDto.section,
            createSubjectPlanDto.year,
            createSubjectPlanDto.semester,
            dependencies,
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
