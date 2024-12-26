import path from "path";
import fs from "fs/promises";
import { ITBACareerPlans } from "./modules";
import careersData from "../careers";
import { SubjectPlan, Subject } from "../ceitbapi/modules";
import { ITBA_API_TOKEN } from "../../../server";

async function getSubjectsByPlan(planId: string): Promise<SubjectPlan[]> {
    const url = `https://itbagw.itba.edu.ar/api/v1/careerPlans/${ITBA_API_TOKEN}?plan=${planId}`;
    const subjectPlan: SubjectPlan[] = [];

    try {
        const data: Response = await fetch(url);
        const jsonData : ITBACareerPlans = await data.json();

        jsonData.careerplan.section.forEach(jsonSection => {
            if (jsonSection.terms != null) {
                jsonSection.terms?.term.forEach(jsonPeriod => {
                    jsonPeriod.entries.entry.forEach(jsonSubject => {
                        if (jsonSubject.type == "subject"){
                            subjectPlan.push({
                                subjectId: jsonSubject.code!,
                                planId: planId,
                                section: jsonSection.name,
                                year: parseInt(jsonPeriod.year),
                                semester: parseInt(jsonPeriod.period),
                                dependencies: jsonSubject.dependencies?.dependency,
                                creditsRequired: jsonSubject.creditsRequired != null ? parseInt(jsonSubject.creditsRequired) : null
                            })
                        }
                    })
                })
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