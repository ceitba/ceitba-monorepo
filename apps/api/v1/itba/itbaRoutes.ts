import express from "express";
import { Request, Response } from "express";
import { getSubjectByPlan, getAllSubjects } from "./subjects";

const router = express.Router();

router.get("/subjects", async (req: Request, res: Response) => {
    console.log('Query: ', req.query);
    const planId = req.query.planId as string;

    if (!planId) {
        const subjects = await getAllSubjects();
        res.status(201).json(subjects);
        return;
    }

    try { 
        const subjects: any = await getSubjectByPlan(planId);
        res.status(201).json(subjects);

    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }

});

export default router;