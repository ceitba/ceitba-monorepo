import { getSubjectsByPlan } from "./subjects";
import { Database,Tables } from "../ceitbapi/database.types";
import { createClient } from "@supabase/supabase-js";
import { ITBA_API_TOKEN, SUPABASE_ACCESS_TOKEN } from "../../../server";
import { DatabaseSubjectPlan, Subject, SubjectPlan } from "../ceitbapi/modules";
import { Root,CourseCommission ,Comissions,CourseCommissionTime} from "./modules/course-times-modules";
import { parse } from 'date-fns';
import { finished } from "stream";
import { update } from "parse/types/ParseHooks";

export async function UpdateSubjects() {
    const supabase = createClient("https://yafawebqzogkzwhxojbh.supabase.co", SUPABASE_ACCESS_TOKEN);
    const { data: plans } = await supabase.from("plan").select().returns<Tables<"plan">[]>();

    const subjectPlans: DatabaseSubjectPlan[] = []

    const missingSubjects: Subject[] = []
    const { data: subjects } = await supabase.from("subject").select().returns<Tables<"subject">[]>();

    for (const plan of plans!) {
        const planData : SubjectPlan[] = await getSubjectsByPlan(plan.id);
        
        const missing = planData.filter((planSubject) => !subjects?.find((subject) => subject.id === planSubject.subject_id));
        // Cuando no hay una materia en la base de datos, se genera y se inserta antes de insertar el plan en supabase
        
        missing.forEach((subject) => {
            missingSubjects.push({
                id: subject.subject_id,
                name: subject.name,
                credits: subject.credits
            })
        })

        const toAdd : DatabaseSubjectPlan[] = planData.map((subject) => {
            return {
                subject_id: subject.subject_id,
                plan_id: plan.id,
                section: subject.section,
                year: subject.year,
                semester: subject.semester,
                dependencies: subject.dependencies,
                credits_required: subject.credits_required
            }
        })

        subjectPlans.push(...toAdd);
    }

    await supabase
        .from('subject')
        .upsert(missingSubjects, { ignoreDuplicates: true })
        .select().then((data) => {  });

    await supabase
    .from('plan_subject')
    .upsert(subjectPlans, { ignoreDuplicates: true })
    .select().then((data) => {
        if (data.error != null) {
            
        }
    });
}

export async function UpdateCommissions(){
    const levels = ["GRADUATE","UNDERGRADUATE"];
    const supabase = createClient("https://yafawebqzogkzwhxojbh.supabase.co", SUPABASE_ACCESS_TOKEN);

    const comissions:Comissions[]=[];
    const comissionTimes:CourseCommissionTime[]=[];

    for (const level of levels) {
        const url = `https://itbagw.itba.edu.ar/api/v1/courseCommissions/${ITBA_API_TOKEN}?level=${level}&year=2025&period=SecondSemester`;
        const data = await fetch(url);
        const jsonData: Root = await data.json();

        if(!jsonData || !jsonData.courseCommissions) continue;

        for (const course of jsonData.courseCommissions.courseCommission) {
            if (!course || !course.courseCommissionTimes){
                console.log(course.subjectName)
                continue;
            }
            
            course.courseCommissionTimes = course.courseCommissionTimes instanceof Array? course.courseCommissionTimes: [course.courseCommissionTimes];
            const courseStart = parse(course.courseStart, 'dd/MM/yy', new Date());
            const courseEnd = parse(course.courseEnd, 'dd/MM/yy', new Date());
            
            switch (course.subjectCode){ // Ignorar materias opcionales de intercambio
                // No me acuerdo cual era la razon de ignorar estas materias
                case "99.52": // Español B2 para extranjeros
                    continue;
                case "99.56": // Español C1 para extranjeros
                    continue;
            }
            comissions.push({
                subject_code:course.subjectCode,
                subject_type:course.subjectType,
                course_start:courseStart,
                course_end:courseEnd,
                commission_name:course.commissionName,
                id:course.commissionId,
                quota:course.quota,
                enrolled_students:course.enrolledStudents})
            
            for (const time of course.courseCommissionTimes){
                if (time == undefined) continue;
                switch (time.building){
                    case "External":
                        time.building = "Online";
                        break;
                    case "Sede Distrito Financiero":
                        time.building = "SDF";
                        break;
                    case "Sede Rectorado":
                        time.building = "SDR";
                        break;
                }
                
                comissionTimes.push({
                    course_id:course.commissionId,
                    day:time.day,
                    class_room:time.classRoom? time.classRoom : "Virtual Asincrónico",
                    building:time.building,
                    hour_from:time.hourFrom,
                    hour_to:time.hourTo
                });
            }
        }
    }
    // Fetch existing subjects to avoid FK violations when inserting commissions
    const { data: existingSubjects, error: subjectFetchError } = await supabase.from('subject').select('id');
    if (subjectFetchError) {
        console.error('Failed to fetch subjects, aborting commission update to prevent inconsistent state.', subjectFetchError);
        return;
    }
    const subjectSet = new Set(existingSubjects?.map(s => (s as any).id));

    // Filter out commissions whose subject does not yet exist (prevents FK error 23503)
    const filteredCommissions = comissions.filter(c => c.subject_code != '94.55' && subjectSet.has(c.subject_code));
    const skippedMissingSubject = comissions.length - filteredCommissions.length;
    if (skippedMissingSubject > 0) {
        console.warn(`Skipped ${skippedMissingSubject} commission(s) due to missing subject reference.`);
    }

    // Full refresh strategy: wipe existing data first (order matters: child table first)
    try {
        await supabase.from('commission_time').delete().not('day', 'eq', 0);
    } catch (e) {
        console.error('Error deleting commission_time (continuing):', e);
    }
    try {
        await supabase.from('commission').delete().not('id', 'eq', 0);
    } catch (e) {
        console.error('Error deleting commission (continuing):', e);
    }

    // Upsert commissions in chunks to reduce chance entire batch fails
    const insertedCommissionIds = new Set<string>();
    const chunkSize = 5; // adjustable
    for (let i = 0; i < filteredCommissions.length; i += chunkSize) {
        const chunk = filteredCommissions.slice(i, i + chunkSize);
        const { data, error } = await supabase
            .from('commission')
            .upsert(chunk, { ignoreDuplicates: false })
            .select();
        if (error) {
            console.error(`Commission upsert chunk starting at index ${i} failed (continuing):`, error);
            // Attempt row-by-row salvage if FK error: insert individually skipping failing ones
            if (error.code === '23503') {
                for (const row of chunk) {
                    const { error: rowError, data: rowData } = await supabase.from('commission').upsert(row, { ignoreDuplicates: false }).select();
                    if (rowError) {
                        console.warn('Skipping commission due to error:', row.id, rowError.message);
                        continue;
                    }
                    rowData?.forEach(r => insertedCommissionIds.add((r as any).id));
                }
            }
        } else {
            data?.forEach(r => insertedCommissionIds.add((r as any).id));
        }
    }

    console.log(`Inserted/updated ${insertedCommissionIds.size} commission(s).`);

    // Filter times to only those with an inserted commission id & explicit exclusions
    const filteredTimes = comissionTimes
        .filter(c => insertedCommissionIds.has(c.course_id) && c.course_id != '43013' && c.course_id != '43014');

    const skippedTimes = comissionTimes.length - filteredTimes.length;
    if (skippedTimes > 0) {
        console.warn(`Skipped ${skippedTimes} commission time entries due to missing commission reference or exclusion.`);
    }

    // Upsert commission times in chunks
    for (let i = 0; i < comissionTimes.length; i += chunkSize) {
        const chunk = comissionTimes.slice(i, i + chunkSize);
        const { error } = await supabase
            .from('commission_time')
            .upsert(chunk, { ignoreDuplicates: true })
            .select();
        if (error) {
            console.error(`commission_time upsert chunk starting at index ${i} failed (continuing):`, error);
            if (error.code === '23503') {
                // Try row-by-row salvage
                for (const row of chunk) {
                    const { error: rowError } = await supabase.from('commission_time').upsert(row, { ignoreDuplicates: true }).select();
                    if (rowError) {
                        console.warn('Skipping commission_time due to error:', row.course_id, rowError.message);
                    }
                }
            }
        }
    }

    console.log('Commission update process finished');
}


