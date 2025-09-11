import express, { Request, Response } from 'express';
import supabase from '../../src/shared/config/supabase';

 

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

/**
 * @openapi
 * tags:
 *   - name: Scheduler
 *     description: Endpoints related to the scheduler
 * components:
 *   schemas:
 *     SubjectResponse:
 *       type: object
 *       properties:
 *         subject_id:
 *           type: string
 *         year:
 *           type: integer
 *           nullable: true
 *         course_start:
 *           type: string
 *           format: date-time
 *         course_end:
 *           type: string
 *           format: date-time
 *         semester:
 *           type: integer
 *           nullable: true
 *         credits_required:
 *           type: integer
 *         dependencies:
 *           type: array
 *           items:
 *             type: string
 *         subject_name:
 *           type: string
 *         credits:
 *           type: integer
 *         commission_name:
 *           type: string
 *         day:
 *           type: string
 *         class_room:
 *           type: string
 *         building:
 *           type: string
 *         hour_from:
 *           type: string
 *         hour_to:
 *           type: string
 *         section:
 *           type: string
 *     SubjectOutput:
 *       type: object
 *       properties:
 *         subject_id:
 *           type: string
 *         name:
 *           type: string
 *         credits:
 *           type: integer
 *         dependencies:
 *           type: array
 *           items:
 *             type: string
 *         credits_required:
 *           type: integer
 *         course_start:
 *           type: string
 *           format: date-time
 *         course_end:
 *           type: string
 *           format: date-time
 *         section:
 *           type: string
 *         category:
 *           type: string
 *         commissions:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               schedule:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     day:
 *                       type: string
 *                     classroom:
 *                       type: string
 *                     building:
 *                       type: string
 *                     time_from:
 *                       type: string
 *                     time_to:
 *                       type: string
 */

/**
 * @openapi
 * /scheduler/subjects:
 *   get:
 *     tags:
 *       - Scheduler
 *     summary: Get subjects by plan
 *     description: Retrieve subjects by plan ID.
 *     parameters:
 *       - in: query
 *         name: plan
 *         schema:
 *           type: string
 *         required: true
 *         description: The plan ID to filter subjects by.
 *     responses:
 *       200:
 *         description: Successfully retrieved subjects.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: object
 *                 additionalProperties:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       $ref: '#/components/schemas/SubjectOutput'
 *       400:
 *         description: Invalid query parameters
 *       500:
 *         description: Internal server error
 */
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
            
            if (!acc[section]) {
                acc[section] = {};
            }
            
            if (!acc[section][year]) {
                acc[section][year] = {};
            }
            
            if (!acc[section][year][semester]) {
                acc[section] [year][semester] = [];
            }
            
            acc[section][year][semester].push(outputItem);
            
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
