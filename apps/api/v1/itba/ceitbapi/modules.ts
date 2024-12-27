export interface Subject {
    id: string;
    name: string;
    credits: number;
}

export interface SubjectPlan{
    subject_id: string;
    plan_id: string;
    section: string;
    year: number;
    semester: number;
    dependencies: string[] | null;
    credits_required: number | null;
    credits:number;
    name:string;
}

export interface Career {
    // careerId: string;
    careerName: string;
    careerPlans: string[];
}