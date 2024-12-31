import careersData from "../careers";
import { getSubjectsByPlan } from "./subjects";
import { Database,Tables } from "../ceitbapi/database.types";
import { createClient } from "@supabase/supabase-js";
import { ITBA_API_TOKEN, SUPABASE_ACCESS_TOKEN } from "../../../server";
import { DatabaseSubjectPlan, Subject, SubjectPlan } from "../ceitbapi/modules";
import { Root,CourseCommission ,Comissions,CourseCommissionTime} from "./modules/course-times-modules";

async function UpdateSubjects() {
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
        .select().then((data) => { console.log(data) });

    await supabase
    .from('plan_subject')
    .upsert(subjectPlans, { ignoreDuplicates: true })
    .select().then((data) => {
        if (data.error != null) {
            console.log(data);
        }
    });
    
}

async function UpdateCommissions(){
    const supabase = createClient("https://yafawebqzogkzwhxojbh.supabase.co", SUPABASE_ACCESS_TOKEN);
    const url = `https://itbagw.itba.edu.ar/api/v1/courseCommissions/${ITBA_API_TOKEN}?level=GRADUATE&year=2025&period=FirstSemester`;

    const data = await fetch(url);
    const jsonData: Root = await data.json();

    const comissions:Comissions[]=[];
    const comissionTimes:CourseCommissionTime[]=[];

    for (const course of jsonData.courseCommissions.courseCommission) {
        course.courseCommissionTimes = course.courseCommissionTimes instanceof Array? course.courseCommissionTimes: [course.courseCommissionTimes];
        comissions.push({
            subject_code:course.subjectCode,
            subject_type:course.subjectType,
            course_start:course.courseStart,
            course_end:course.courseEnd,
            comission_name:course.commissionName,
            id:course.commissionId,
            quota:course.quota,
            enrolled_students:course.enrolledStudents})

        

        for (const time of course.courseCommissionTimes){
            if (time == undefined) continue;
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

    await supabase
        .from('course')
        .upsert(comissions, { ignoreDuplicates: true })
        .select().then((data) => { console.log(data) });

    await supabase
    .from('course_time')
    .upsert(comissionTimes, { ignoreDuplicates: true })
    .select().then((data) => {
        if (data.error != null) {
            console.log(data);
        }
    });
    
    
}


//UpdateSubjects();

UpdateCommissions();

