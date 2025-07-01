import { getSubjectsByPlan } from "./subjects";
import { Database,Tables } from "../ceitbapi/database.types";
import { createClient } from "@supabase/supabase-js";
import { ITBA_API_TOKEN, SUPABASE_ACCESS_TOKEN } from "../../../server";
import { DatabaseSubjectPlan, Subject, SubjectPlan } from "../ceitbapi/modules";
import { Root,CourseCommission ,Comissions,CourseCommissionTime} from "./modules/course-times-modules";
import { parse } from 'date-fns';

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
            console.log(data);
        }
    });
    
}

export async function UpdateCommissions(){
    const levels = ["GRADUATE","UNDERGRADUATE"];
    const supabase = createClient("https://yafawebqzogkzwhxojbh.supabase.co", SUPABASE_ACCESS_TOKEN);

    const comissions:Comissions[]=[];
    const comissionTimes:CourseCommissionTime[]=[];

    for (const level of levels) {
        const url = `https://itbagw.itba.edu.ar/api/v1/courseCommissions/${ITBA_API_TOKEN}?level=${level}&year=2025&period=FirstSemester`;
        const data = await fetch(url);
        const jsonData: Root = await data.json();

        for (const course of jsonData.courseCommissions.courseCommission) {
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
                    class_room:time.classRoom,
                    building:time.building,
                    hour_from:time.hourFrom,
                    hour_to:time.hourTo
                });
            }
        }
    }

    
    // Delete all commission time
    await supabase.from('commission_time').delete().neq("day",0)

    // Delete all commission
    await supabase.from('commission').delete().neq("id",0)
    await supabase
        .from('commission')
        .upsert(comissions, { ignoreDuplicates: false })
        .select()

    
    
    await supabase
    .from('commission_time')
    .upsert(comissionTimes, { ignoreDuplicates: true })
    .select()
}
