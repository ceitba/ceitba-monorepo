export interface SubjectPlanDto {
    subjectId: string;
    planId: string;
    section: string;
    year: number | null;
    semester: number | null;
    dependencies: string[];
    creditsRequired: number | null;
    subject: {
        id: string;
        name: string;
        credits: number;
    };
}

export interface CreateSubjectPlanDto {
    subjectId: string;
    planId: string;
    section: string;
    year: number | null;
    semester: number | null;
    dependencies: string[];
    creditsRequired: number | null;
}

// Legacy interface for backward compatibility
export interface DatabaseSubjectPlan {
    subject_id: string;
    plan_id: string;
    section: string;
    year: number | null;
    semester: number | null;
    dependencies: string[] | null;
    credits_required: number | null;
}

export interface SubjectPlan {
    subject_id: string;
    plan_id: string;
    section: string;
    year: number | null;
    semester: number | null;
    dependencies: string[] | null;
    credits_required: number | null;
    credits: number;
    name: string;
}
