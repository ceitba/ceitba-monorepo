import { createClient } from '@supabase/supabase-js';
import express, { Request, Response } from 'express';
import { SUPABASE_ACCESS_TOKEN } from '../../server';

const router = express.Router();



router.get("/subjects", async (req: Request, res: Response) => {
    const { plan } = req.query
    
    if ( !plan ) {
        res.status(400).json({ error: "Invalid query parameters" });
        return
    }

    const supabase = createClient("https://yafawebqzogkzwhxojbh.supabase.co", SUPABASE_ACCESS_TOKEN);
    const { data, error } = await supabase
        .from("plan_subject")
        .select('subject_id, year, semester, credits_required, dependencies, subject(name, credits)')
        .eq("plan_id", plan as string)
        .returns<any[]>()

    if (error) {
        res.status(500).json({ error: error.message });
        return
    }

    const groupedData = data.reduce((acc, item) => {
        const { year, semester, subject, subject_id, credits_required, dependencies } = item;
        const newItem = {
            subject_id,
            name: subject.name,
            credits: subject.credits,
            dependencies,
            credits_required
        };
        if (!acc[year]) {
            acc[year] = {};
        }
        if (!acc[year][semester]) {
            acc[year][semester] = [];
        }
        acc[year][semester].push(newItem);
        return acc;
    }, {});

    res.status(200).json(groupedData);
});

export default router;