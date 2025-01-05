import express, { Request, Response } from 'express';
import supabase from '../config/supabase';

 

interface SubjectResponse {
    subject_id: string;
    year: number | null;
    course_start: Date;
    course_end: Date;
    semester: number | null;
    credits_required: number;
    dependencies: string[];
    subject_name: string;
    credits: number;
    commission_name: string;
    day: string;
    class_room: string;
    building: string;
    hour_from: string;
    hour_to: string;
    section:string;
    
}

interface SubjectOutput {
    subject_id: string;
    name: string;
    credits: number;
    dependencies: string[];
    credits_required: number;
    course_start: Date;
    course_end: Date;
    section:string;
    category:string;
    commissions?: {
        name: string;
        schedule?: {
            day: string;
            classroom: string;
            building: string;
            time_from: string;
            time_to: string;
        }[]
    }[]
}

const router = express.Router();

router.get("/subjects", async (req: Request, res: Response) => {
    const { plan } = req.query;
    
    if (!plan) {
        res.status(400).json({ error: "Invalid query parameters" });
        return;
    }

    const { data, error } = await supabase
        .rpc('get_subjects_by_plan', { 
            input_plan_id: plan as string 
        });

    if (error) {
        console.error('Supabase error:', error);
        res.status(500).json({ error: error.message });
        return;
    }

    console.log(data);

    type GroupedSubjects = Record<string,Record<number, Record<number, SubjectOutput[]>>>;
    
    // First, group by subjects to combine commissions
    const subjectsMap = (data as SubjectResponse[]).reduce((acc, item) => {
        const key = item.subject_id;
        if (!acc.has(key)) {
            acc.set(key, {
                subject_id: item.subject_id,
                name: item.subject_name,
                credits: item.credits,
                dependencies: item.dependencies || [],
                credits_required: item.credits_required,
                year: item.year??0,
                course_start: item.course_start,
                course_end: item.course_end,
                semester: item.semester??0,
                section:item.section,
                commissions: new Map()
            });
        }
        
        const subject = acc.get(key)!;
        if (!subject.commissions.has(item.commission_name)) {
            subject.commissions.set(item.commission_name, {
                name: item.commission_name,
                schedule: []
            });
        }
        
        subject.commissions.get(item.commission_name)!.schedule.push({
            day: item.day,
            classroom: item.class_room,
            building: item.building,
            time_from: item.hour_from,
            time_to: item.hour_to
        });
        
        return acc;
    }, new Map());

    // Convert to final grouped structure
    const groupedData = Array.from(subjectsMap.values()).reduce<GroupedSubjects>(
        (acc, item) => {
            const { year, semester,section, ...subjectData } = item;
            
            
            const outputItem: SubjectOutput = {
                section:section,
                ...subjectData,
                commissions: Array.from(item.commissions.values())
            };
            console.log(year,semester,section,outputItem);
            if (!acc[section]) {
                acc[section] = {};
            }
            console.log(acc);
            if (!acc[section][year]) {
                acc[section][year] = {};
            }
            console.log(acc);
            if (!acc[section][year][semester]) {
                acc[section] [year][semester] = [];
            }
            console.log(acc);
            acc[section][year][semester].push(outputItem);
            console.log(acc);
            return acc;
        },
        {}
    );

    //sort the grouped data so the 0 0 sections go last
    const sortedData = Object.keys(groupedData).sort().reduce((acc, key) => {
        acc[key] = groupedData[key];
        return acc;
    }, {} as GroupedSubjects);

    res.status(200).json(sortedData);
});

export default router;
