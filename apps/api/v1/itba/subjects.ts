import path from "path";
import fs from "fs/promises";

interface Subject {
    id: string;
    name: string;
    credits: number;
}

interface SubjectPlan{
    subjectId: string;
    planId: string;
    year: number;
    semester: number;
    dependencies: string[] | null;
    creditsRequired: number;
}

interface Career {
    careerName: string;
    careerPlans: string[];
}

async function getSubjectByPlan(planId: string): Promise<Subject[]> {
    const url = `https://itbagw.itba.edu.ar/api/v1/careerPlans/${process.env.ITBA_API_TOKEN}?plan=${planId}`;
    const subjects: Subject[] = [];

    try {
        const data: Response = await fetch(url);
        const jsonData = await data.json();
    
        jsonData.careerplan.section.forEach((section: any) => {
            if (section.terms && section.terms.term) {
                section.terms.term.forEach((term: any) => {
                    if (term.entries && term.entries.entry) {
                        const entries = Array.isArray(term.entries.entry) ? term.entries.entry : [term.entries.entry];
                        entries.forEach((entry: any) => {
                            if (entry.type === "subject") {
                                const dependencies = entry.dependencies ? entry.dependencies.dependency : [];
                                const dependencies_all = Array.isArray(dependencies) ? 
                                dependencies.map((dep: string) => dep) : [dependencies];

                                const subject: Subject = {
                                    name: entry.name,
                                    id: entry.code,
                                    credits: parseInt(entry.credits, 10),
                                };
                                subjects.push(subject);
                            }
                        });
                    }
                });
            }
        });
    
        return subjects;
    } catch (error) {
        throw new Error("Error fetching data from ITBA API for planId: " + planId + " - " + (error as Error).message);
    }

}

async function getAllSubjects(): Promise<Subject[]> {
    const subjectPlans: SubjectPlan[] = [];
    const careersFilePath = path.join(__dirname, 'careers.json');
    const careersData = await fs.readFile(careersFilePath, 'utf-8');
    const careers: Record<string, Career> = JSON.parse(careersData);

    const allSubjects: Map<String, Subject> = new Map();

    for (const careerKey in careers) {
    if (careers.hasOwnProperty(careerKey)) {
        const career = careers[careerKey];
        const latestPlan = career.careerPlans[0]; // The latest plan is the first one in the list
        const subjects = await getSubjectByPlan(latestPlan);
       
        subjects.forEach((subject) => {
            allSubjects.set(subject.id ,subject);
        });
    }
}
    
    return Array.from(allSubjects.values());;
}


export { getSubjectByPlan, getAllSubjects };