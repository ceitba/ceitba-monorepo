export interface Subject {
    id: string;
    name: string;
    credits: number;
}

export interface SubjectPlan{
    subjectId: string;
    planId: string;
    section: string;
    year: number;
    semester: number;
    dependencies: string[] | null;
    creditsRequired: number | null;
}

export interface Career {
    // careerId: string;
    careerName: string;
    careerPlans: string[];
}