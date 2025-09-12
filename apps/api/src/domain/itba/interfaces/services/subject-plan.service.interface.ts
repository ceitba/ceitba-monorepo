import { SubjectPlan } from '@/domain/itba/models/subject-plan.model';
import { CreateSubjectPlanDto } from '@/domain/itba/dto/subjectPlan.dto';

export interface SubjectPlanServiceInterface {
    getSubjectsByPlan(planId: string): Promise<SubjectPlan[]>;
    getSubjectsByPlanFromApi(planId: string): Promise<SubjectPlan[]>;
    getSubjectPlansBySubject(subjectId: string): Promise<SubjectPlan[]>;
    getSubjectPlan(planId: string, subjectId: string): Promise<SubjectPlan | null>;
    createSubjectPlan(createSubjectPlanDto: CreateSubjectPlanDto): Promise<SubjectPlan>;
    updateSubjectPlan(
        planId: string,
        subjectId: string,
        updateData: Partial<CreateSubjectPlanDto>
    ): Promise<SubjectPlan | null>;
    deleteSubjectPlan(planId: string, subjectId: string): Promise<boolean>;
    getSubjectsBySection(planId: string, section: string): Promise<SubjectPlan[]>;
    getElectiveSubjects(planId: string): Promise<SubjectPlan[]>;
    getSubjectsByYear(planId: string, year: number): Promise<SubjectPlan[]>;
    getSubjectsBySemester(planId: string, year: number, semester: number): Promise<SubjectPlan[]>;
    getSubjectDependencies(planId: string, subjectId: string): Promise<SubjectPlan[]>;
}
