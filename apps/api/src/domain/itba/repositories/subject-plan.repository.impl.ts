import { SubjectPlan } from '@/domain/itba/models/subject-plan.model';
import { Subject } from '@/domain/itba/models/subject.model';
import { SubjectPlanRepository } from '@/domain/itba/interfaces/repositories/subject-plan.repository.interface';
import { SubjectPlanNotFoundException, SubjectPlanAlreadyExistsException, ForeignKeyConstraintViolationException } from '@/domain/itba/exceptions/itba.exceptions';
import { GenericDomainException } from '@/shared/exceptions';
import { PrismaService } from '@/shared/database/prisma.service';

export class SubjectPlanRepositoryImpl implements SubjectPlanRepository {
    private readonly prisma: PrismaService;

    constructor(prisma: PrismaService) {
        this.prisma = prisma;
    }

    async findAll(): Promise<SubjectPlan[]> {
        const planSubjects = await this.prisma.planSubject.findMany({
            orderBy: [{ planId: 'asc' }, { subjectId: 'asc' }]
        });

        // Get all unique subject IDs
        const subjectIds = [...new Set(planSubjects.map(ps => ps.subjectId))];
        
        // Fetch 
        const subjects = await this.prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true, credits: true }
        });

      
        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        return planSubjects.map(ps => this.mapToSubjectPlan(ps, subjectMap.get(ps.subjectId)!));
    }

    async findByPlanId(planId: string): Promise<SubjectPlan[]> {
        const planSubjects = await this.prisma.planSubject.findMany({
            where: { planId },
            orderBy: { subjectId: 'asc' }
        });

        if (planSubjects.length === 0) {
            return [];
        }

        const subjectIds = planSubjects.map(ps => ps.subjectId);
        
        const subjects = await this.prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true, credits: true }
        });

        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        return planSubjects.map(ps => this.mapToSubjectPlan(ps, subjectMap.get(ps.subjectId)!));
    }

    async findBySubjectId(subjectId: string): Promise<SubjectPlan[]> {
        const planSubjects = await this.prisma.planSubject.findMany({
            where: { subjectId },
            orderBy: { planId: 'asc' }
        });

        if (planSubjects.length === 0) {
            return [];
        }

        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
            select: { id: true, name: true, credits: true }
        });

        if (!subject) {
            throw new Error(`Subject with ID ${subjectId} not found`);
        }

        return planSubjects.map(ps => this.mapToSubjectPlan(ps, subject));
    }

    async findByPlanAndSubject(planId: string, subjectId: string): Promise<SubjectPlan | null> {
        const planSubject = await this.prisma.planSubject.findUnique({
            where: {
                subjectId_planId: {
                    subjectId,
                    planId
                }
            }
        });

        if (!planSubject) {
            return null;
        }

        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectId },
            select: { id: true, name: true, credits: true }
        });

        if (!subject) {
            throw new Error(`Subject with ID ${subjectId} not found`);
        }

        return this.mapToSubjectPlan(planSubject, subject);
    }

    async create(subjectPlan: SubjectPlan): Promise<SubjectPlan> {
        const planSubjectResult = await this.prisma.planSubject.create({
            data: {
                subjectId: subjectPlan.subjectId,
                planId: subjectPlan.planId,
                section: subjectPlan.section,
                year: subjectPlan.year ?? 0,
                semester: subjectPlan.semester ?? 0,
                dependencies: subjectPlan.dependencies,
                creditsRequired: subjectPlan.creditsRequired ?? 0
            }
        }).catch(err => {
            switch (err.code) {
                case 'P2002':
                    throw new SubjectPlanAlreadyExistsException(
                        `Subject plan for plan ${subjectPlan.planId} and subject ${subjectPlan.subjectId} already exists`, 
                        err
                    );
                case 'P2003':
                    throw new ForeignKeyConstraintViolationException(
                        `Invalid foreign key reference in subject plan`, 
                        err
                    );
                default:
                    throw new GenericDomainException(`Failed to create subject plan`, err);
            }
        });

        // Fetch the subject
        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectPlan.subjectId },
            select: { id: true, name: true, credits: true }
        });

        if (!subject) {
            throw new Error(`Subject with ID ${subjectPlan.subjectId} not found`);
        }

        return this.mapToSubjectPlan(planSubjectResult, subject);
    }

    async update(subjectPlan: SubjectPlan): Promise<SubjectPlan> {
        const planSubjectResult = await this.prisma.planSubject.update({
            where: {
                subjectId_planId: {
                    subjectId: subjectPlan.subjectId,
                    planId: subjectPlan.planId
                }
            },
            data: {
                section: subjectPlan.section,
                year: subjectPlan.year ?? 0,
                semester: subjectPlan.semester ?? 0,
                dependencies: subjectPlan.dependencies,
                creditsRequired: subjectPlan.creditsRequired ?? 0
            }
        }).catch(err => {
            switch (err.code) {
                case 'P2025':
                    throw new SubjectPlanNotFoundException(
                        subjectPlan.planId,
                        subjectPlan.subjectId,
                        err
                    );
                case 'P2002':
                    throw new SubjectPlanAlreadyExistsException(
                        `Subject plan for plan ${subjectPlan.planId} and subject ${subjectPlan.subjectId} already exists`, 
                        err
                    );
                case 'P2003':
                    throw new ForeignKeyConstraintViolationException(
                        `Invalid foreign key reference in subject plan`, 
                        err
                    );
                default:
                    throw new GenericDomainException('Failed to update subject plan', err);
            }
        });

        const subject = await this.prisma.subject.findUnique({
            where: { id: subjectPlan.subjectId },
            select: { id: true, name: true, credits: true }
        });

        if (!subject) {
            throw new Error(`Subject with ID ${subjectPlan.subjectId} not found`);
        }

        return this.mapToSubjectPlan(planSubjectResult, subject);
    }

    async delete(planId: string, subjectId: string): Promise<void> {
        await this.prisma.planSubject.delete({
            where: {
                subjectId_planId: {
                    subjectId,
                    planId
                }
            }
        }).catch(err => {
            switch (err.code) {
                case 'P2025':
                    throw new SubjectPlanNotFoundException(
                        planId,
                        subjectId,
                        err
                    );
                case 'P2003':
                    throw new ForeignKeyConstraintViolationException(
                        `Cannot delete subject plan: it has related records`, 
                        err
                    );
                default:
                    throw new GenericDomainException('Failed to delete subject plan', err);
            }
        });
    }

    async findBySection(planId: string, section: string): Promise<SubjectPlan[]> {
        const planSubjects = await this.prisma.planSubject.findMany({
            where: { 
                planId, 
                section 
            },
            orderBy: { subjectId: 'asc' }
        });

        if (planSubjects.length === 0) {
            return [];
        }

        const subjectIds = planSubjects.map(ps => ps.subjectId);
        
        const subjects = await this.prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true, credits: true }
        });

        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        return planSubjects.map(ps => this.mapToSubjectPlan(ps, subjectMap.get(ps.subjectId)!));
    }

    async findElectives(planId: string): Promise<SubjectPlan[]> {
        const planSubjects = await this.prisma.planSubject.findMany({
            where: { 
                planId,
                year: 0,
                semester: 0
            },
            orderBy: { subjectId: 'asc' }
        });

        if (planSubjects.length === 0) {
            return [];
        }

        const subjectIds = planSubjects.map(ps => ps.subjectId);
        
        const subjects = await this.prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true, credits: true }
        });

        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        return planSubjects.map(ps => this.mapToSubjectPlan(ps, subjectMap.get(ps.subjectId)!));
    }

    async findByYear(planId: string, year: number): Promise<SubjectPlan[]> {
        const planSubjects = await this.prisma.planSubject.findMany({
            where: { 
                planId, 
                year 
            },
            orderBy: [{ semester: 'asc' }, { subjectId: 'asc' }]
        });

        if (planSubjects.length === 0) {
            return [];
        }

        const subjectIds = planSubjects.map(ps => ps.subjectId);
        
        const subjects = await this.prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true, credits: true }
        });

        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        return planSubjects.map(ps => this.mapToSubjectPlan(ps, subjectMap.get(ps.subjectId)!));
    }

    async findBySemester(planId: string, year: number, semester: number): Promise<SubjectPlan[]> {
        const planSubjects = await this.prisma.planSubject.findMany({
            where: { 
                planId, 
                year, 
                semester 
            },
            orderBy: { subjectId: 'asc' }
        });

        if (planSubjects.length === 0) {
            return [];
        }

        const subjectIds = planSubjects.map(ps => ps.subjectId);
        
        const subjects = await this.prisma.subject.findMany({
            where: { id: { in: subjectIds } },
            select: { id: true, name: true, credits: true }
        });

        const subjectMap = new Map(subjects.map(s => [s.id, s]));

        return planSubjects.map(ps => this.mapToSubjectPlan(ps, subjectMap.get(ps.subjectId)!));
    }

    private mapToSubjectPlan(planSubjectData: any, subjectData: any): SubjectPlan {
        const subject = new Subject(
            subjectData.id,
            subjectData.name,
            subjectData.credits
        );

        return new SubjectPlan(
            planSubjectData.subjectId,
            planSubjectData.planId,
            planSubjectData.section,
            planSubjectData.year,
            planSubjectData.semester,
            planSubjectData.dependencies || [],
            planSubjectData.creditsRequired,
            subject
        );
    }
}

