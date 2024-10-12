import path from "path";
import fs from "fs/promises";

interface Subject {
    code: string;
    name: string;
    credits: number;
    prerequisites: string[];
    credits_required: number;
}

interface Career {
    careerName: string;
    careerPlans: string[];
}


async function getSubjectByPlan(planId: string): Promise<Subject[]> {
    const url = `https://itbagw.itba.edu.ar/api/v1/careerPlans/${process.env.ITBA_API_TOKEN}?plan=${planId}`;
    try {
        const data: Response = await fetch(url);
        const jsonData = await data.json();
        const subjects: Subject[] = [];
    
        jsonData.careerplan.section.forEach((section: any) => {
            if (section.terms && section.terms.term) {
                section.terms.term.forEach((term: any) => {
                    if (term.entries && term.entries.entry) {
                        const entries = Array.isArray(term.entries.entry) ? term.entries.entry : [term.entries.entry];
                        entries.forEach((entry: any) => {
                            if (entry.type === "subject") {
                                const dependencies = entry.dependencies ? entry.dependencies.dependency : [];
                                const prerequisites = Array.isArray(dependencies) ? 
                                dependencies.map((dep: string) => dep) : [dependencies];

                                const subject: Subject = {
                                    name: entry.name,
                                    code: entry.code,
                                    credits: parseInt(entry.credits, 10),
                                    prerequisites: prerequisites,
                                    credits_required: entry.creditsRequired ? parseInt(entry.creditsRequired, 10) : 0
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
    const careersFilePath = path.join(__dirname, 'careers.json');
    const careersData = await fs.readFile(careersFilePath, 'utf-8');
    const careers: Record<string, Career> = JSON.parse(careersData);

    const allSubjects: Subject[] = [];

    for (const careerKey in careers) {
        if (careers.hasOwnProperty(careerKey)) {
            const career = careers[careerKey];
            const latestPlan = career.careerPlans[0]; // The latest plan is the first one in the list
            const subjects = await getSubjectByPlan(latestPlan);
            allSubjects.push(...subjects.filter ((subject) => !allSubjects.some((s) => s.code === subject.code)));
        }
    }

    return allSubjects;
}


export { getSubjectByPlan, getAllSubjects };