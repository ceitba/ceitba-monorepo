import careersData from "../v1/itba/careers";
import { getSubjectsByPlan } from "../v1/itba/itbagw/subjects";
import { Database,Tables } from "../v1/itba/ceitbapi/database.types";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ACCESS_TOKEN } from "../server";


async function main() {
    const supabase = createClient("https://yafawebqzogkzwhxojbh.supabase.co", SUPABASE_ACCESS_TOKEN);

    
    
    const { data: plans } = await supabase.from("plan").select().returns<Tables<"plan">[]>();
    console.log(plans);
    var tasks = plans!.map(async (plan) => {
        const planData = await getSubjectsByPlan(plan.id);
        const { data: subjects} = await supabase.from("subject").select().returns<Tables<"subject">[]>();
        const missingSubjects = planData.filter((planSubject) => !subjects?.find((subject) => subject.id === planSubject.subject_id));
        // Cuando no hay una materia en la base de datos, se genera y se inserta antes de insertar el plan en supabase

        await supabase
            .from('plan_subject')
            .upsert(planData)
            .select().then((data) => {
                console.log(data);
            });
    });

/* 
    const planData = await getSubjectsByPlan("S10-Rev23");

    const serializedData = JSON.parse(JSON.stringify(planData));
    //console.log(planData);

    
    console.log(serializedData);
    const { data, error } = await supabase
        .from('plan_subject')
        .upsert(planData)
        .select();

    console.log(data);
    console.log(error);
   
     */
    
}


main();

