import { SubjectPlan } from '../models/subject-plan.model';
import { Subject } from '../models/subject.model';
import { SubjectPlanRepository } from '../interfaces/subject-plan.repository.interface';
import { DatabaseClient, DatabaseFactory, DatabaseErrorCode } from '../../../shared/database';

export class SubjectPlanRepositoryImpl implements SubjectPlanRepository {
    private readonly db: DatabaseClient;

    constructor(db?: DatabaseClient) {
        this.db = db || DatabaseFactory.getInstance();
    }

    async findAll(): Promise<SubjectPlan[]> {
        const result = await this.db.select<any>('plan_subject', {
            select: '*',
            joins: [{
                table: 'subject',
                foreignKey: 'subject_id',
                select: 'id, name, credits'
            }]
        });

        if (result.error) {
            throw new Error(`Error fetching subject plans: ${result.error.message}`);
        }

        return result.data!.map(this.mapToSubjectPlan);
    }

    async findByPlanId(planId: string): Promise<SubjectPlan[]> {
        const result = await this.db.select<any>('plan_subject', {
            select: '*',
            eq: { plan_id: planId },
            joins: [{
                table: 'subject',
                foreignKey: 'subject_id',
                select: 'id, name, credits'
            }]
        });

        if (result.error) {
            throw new Error(`Error fetching subject plans by plan ID: ${result.error.message}`);
        }

        return result.data!.map(this.mapToSubjectPlan);
    }

    async findBySubjectId(subjectId: string): Promise<SubjectPlan[]> {
        const result = await this.db.select<any>('plan_subject', {
            select: '*',
            eq: { subject_id: subjectId },
            joins: [{
                table: 'subject',
                foreignKey: 'subject_id',
                select: 'id, name, credits'
            }]
        });

        if (result.error) {
            throw new Error(`Error fetching subject plans by subject ID: ${result.error.message}`);
        }

        return result.data!.map(this.mapToSubjectPlan);
    }

    async findByPlanAndSubject(planId: string, subjectId: string): Promise<SubjectPlan | null> {
        const result = await this.db.selectOne<any>('plan_subject', {
            select: '*',
            eq: { plan_id: planId, subject_id: subjectId },
            joins: [{
                table: 'subject',
                foreignKey: 'subject_id',
                select: 'id, name, credits'
            }]
        });

        if (result.error) {
            if (result.error.isNotFound()) {
                return null;
            }
            throw new Error(`Error fetching subject plan: ${result.error.message}`);
        }

        if (!result.data) {
            return null;
        }

        return this.mapToSubjectPlan(result.data);
    }

    async create(subjectPlan: SubjectPlan): Promise<SubjectPlan> {
        const result = await this.db.insert<any>('plan_subject', {
            data: {
                subject_id: subjectPlan.subjectId,
                plan_id: subjectPlan.planId,
                section: subjectPlan.section,
                year: subjectPlan.year,
                semester: subjectPlan.semester,
                dependencies: subjectPlan.dependencies,
                credits_required: subjectPlan.creditsRequired
            }
        });

        if (result.error) {
            throw new Error(`Error creating subject plan: ${result.error.message}`);
        }

        const insertedData = Array.isArray(result.data) ? result.data[0] : result.data;
        
        // Now fetch the created record with the joined subject data
        const createdRecord = await this.findByPlanAndSubject(
            subjectPlan.planId, 
            subjectPlan.subjectId
        );

        if (!createdRecord) {
            throw new Error('Failed to retrieve created subject plan');
        }

        return createdRecord;
    }

    async update(subjectPlan: SubjectPlan): Promise<SubjectPlan> {
        const result = await this.db.update<any>('plan_subject', {
            data: {
                section: subjectPlan.section,
                year: subjectPlan.year,
                semester: subjectPlan.semester,
                dependencies: subjectPlan.dependencies,
                credits_required: subjectPlan.creditsRequired
            },
            where: { 
                plan_id: subjectPlan.planId,
                subject_id: subjectPlan.subjectId 
            }
        });

        if (result.error) {
            throw new Error(`Error updating subject plan: ${result.error.message}`);
        }

        // Fetch the updated record with joined subject data
        const updatedRecord = await this.findByPlanAndSubject(
            subjectPlan.planId,
            subjectPlan.subjectId
        );

        if (!updatedRecord) {
            throw new Error('Failed to retrieve updated subject plan');
        }

        return updatedRecord;
    }

    async delete(planId: string, subjectId: string): Promise<void> {
        const result = await this.db.delete('plan_subject', {
            where: { 
                plan_id: planId,
                subject_id: subjectId 
            }
        });

        if (result.error) {
            throw new Error(`Error deleting subject plan: ${result.error.message}`);
        }
    }

    async findBySection(planId: string, section: string): Promise<SubjectPlan[]> {
        const result = await this.db.select<any>('plan_subject', {
            select: '*',
            eq: { plan_id: planId, section: section },
            joins: [{
                table: 'subject',
                foreignKey: 'subject_id',
                select: 'id, name, credits'
            }]
        });

        if (result.error) {
            throw new Error(`Error fetching subject plans by section: ${result.error.message}`);
        }

        return result.data!.map(this.mapToSubjectPlan);
    }

    async findElectives(planId: string): Promise<SubjectPlan[]> {
        const result = await this.db.select<any>('plan_subject', {
            select: '*',
            eq: { plan_id: planId },
            is: { year: null, semester: null },
            joins: [{
                table: 'subject',
                foreignKey: 'subject_id',
                select: 'id, name, credits'
            }]
        });

        if (result.error) {
            throw new Error(`Error fetching elective subjects: ${result.error.message}`);
        }

        return result.data!.map(this.mapToSubjectPlan);
    }

    async findByYear(planId: string, year: number): Promise<SubjectPlan[]> {
        const result = await this.db.select<any>('plan_subject', {
            select: '*',
            eq: { plan_id: planId, year: year },
            joins: [{
                table: 'subject',
                foreignKey: 'subject_id',
                select: 'id, name, credits'
            }]
        });

        if (result.error) {
            throw new Error(`Error fetching subject plans by year: ${result.error.message}`);
        }

        return result.data!.map(this.mapToSubjectPlan);
    }

    async findBySemester(planId: string, year: number, semester: number): Promise<SubjectPlan[]> {
        const result = await this.db.select<any>('plan_subject', {
            select: '*',
            eq: { plan_id: planId, year: year, semester: semester },
            joins: [{
                table: 'subject',
                foreignKey: 'subject_id',
                select: 'id, name, credits'
            }]
        });

        if (result.error) {
            throw new Error(`Error fetching subject plans by semester: ${result.error.message}`);
        }

        return result.data!.map(this.mapToSubjectPlan);
    }

    private mapToSubjectPlan(data: any): SubjectPlan {
        const subject = new Subject(
            data.subject.id,
            data.subject.name,
            data.subject.credits
        );

        return new SubjectPlan(
            data.subject_id,
            data.plan_id,
            data.section,
            data.year,
            data.semester,
            data.dependencies || [],
            data.credits_required,
            subject
        );
    }
}
