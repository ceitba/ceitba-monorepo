import { SubjectPlan } from '@/domain/itba/models/subject-plan.model';

export interface ItbaApiService {
    getSubjectsByPlan(planId: string): Promise<SubjectPlan[]>;
    getAllSubjects(): Promise<any[]>; 
}

export interface ITBACareerPlans {
    careerplan: ITBACareerplan;
}

export interface ITBACareerplan {
    name: string;
    career: string;
    degreeLevel: string;
    since: string;
    section: ITBASection[];
}

export interface ITBASection {
    name: string;
    terms?: ITBATerms;
    withoutTerm?: ITBAWithoutTerms;
}

export interface ITBATerms {
    term: ITBATerm[];
}

export interface ITBATerm {
    year: string;
    period: string;
    entries: ITBAEntries;
}

export interface ITBAEntries {
    entry: ITBASubject[];
}

export interface ITBASubject {
    type: string;
    name: string;
    code?: string;
    credits: string;
    dependencies?: ITBADependencies;
    creditsRequired?: string;
}

export interface ITBADependencies {
    dependency: any;
}

export interface ITBAWithoutTerms {
    withoutTerm: ITBASubject[];
}
