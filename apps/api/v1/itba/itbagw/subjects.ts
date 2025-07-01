import path from "path";
import fs from "fs/promises";
import { ITBACareerPlans } from "./modules/career-plan-modules";
import { SubjectPlan, Subject } from "../ceitbapi/modules";
import { ITBA_API_TOKEN } from "../../../server";


async function getSubjectsByPlan(planId: string): Promise<SubjectPlan[]> {
    const url = `https://itbagw.itba.edu.ar/api/v1/careerPlans/${ITBA_API_TOKEN}?plan=${planId}`;
    const subjectPlan: SubjectPlan[] = [];

    try {
        const data: Response = await fetch(url);
        const jsonData: ITBACareerPlans = await data.json();

        jsonData.careerplan.section = jsonData.careerplan.section instanceof Array ? jsonData.careerplan.section : [jsonData.careerplan.section];

        jsonData.careerplan.section.forEach(jsonSection => {
            if (jsonSection.terms != null) {
                jsonSection.terms?.term.forEach(jsonPeriod => {
                    if (jsonPeriod.entries != null) {
                        jsonPeriod.entries.entry = jsonPeriod.entries.entry instanceof Array ? jsonPeriod.entries.entry : [jsonPeriod.entries.entry];
                        jsonPeriod.entries.entry.forEach(jsonSubject => {
                            if (jsonSubject.type == "subject") {
                                var dependencies: string[] | null = null;
                                if (jsonSubject.dependencies?.dependency != null) {
                                    if (jsonSubject.dependencies?.dependency instanceof Array) {
                                        dependencies= jsonSubject.dependencies?.dependency
                                    } else {
                                        dependencies= [jsonSubject.dependencies?.dependency];
                                    }
                                }

                                subjectPlan.push({
                                    subject_id: jsonSubject.code!,
                                    name: jsonSubject.name,
                                    credits: parseInt(jsonSubject.credits),
                                    plan_id: planId,
                                    section: jsonSection.name,
                                    year: parseInt(jsonPeriod.year),
                                    semester: parseInt(jsonPeriod.period),
                                    dependencies: dependencies ?? null,
                                    credits_required: jsonSubject.creditsRequired != null ? parseInt(jsonSubject.creditsRequired) : null
                                })
                            }
                        })
                    }
                    
                })
            } else if (jsonSection.withoutTerm != null) {
             
                jsonSection.withoutTerm.withoutTerm = jsonSection.withoutTerm.withoutTerm instanceof Array ? jsonSection.withoutTerm.withoutTerm : [jsonSection.withoutTerm.withoutTerm];
                for (const jsonSubject of jsonSection.withoutTerm.withoutTerm) 
               {
                    if (jsonSubject.type == "subject") {
                        var dependencies: string[] | null = null;
                        if (jsonSubject.dependencies?.dependency != null) {
                            if (jsonSubject.dependencies?.dependency instanceof Array) {
                                dependencies= jsonSubject.dependencies?.dependency
                            } else {
                                dependencies= [jsonSubject.dependencies?.dependency];
                            }
                        }

                        subjectPlan.push({
                            subject_id: jsonSubject.code!,
                            name: jsonSubject.name,
                            credits: parseInt(jsonSubject.credits),
                            plan_id: planId,
                            section: jsonSection.name,
                            year: null,
                            semester: null,
                            dependencies: dependencies ?? null,
                            credits_required: jsonSubject.creditsRequired != null ? parseInt(jsonSubject.creditsRequired) : null
                        })
                    }
                }
            }

        })
        return subjectPlan;
    } catch (error) {
        throw new Error("Error fetching data from ITBA API for planId: " + planId + " - " + (error as Error).message);
    }
}

async function getAllSubjects(): Promise<Subject[]> {
    return [];
}


export { getSubjectsByPlan, getAllSubjects };