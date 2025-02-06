import express from "express";
import { Request, Response } from "express";
import { getSubjectsByPlan, getAllSubjects } from "./itbagw/subjects";
import classRoomsRouter from "./classrooms/classRooms";
const router = express.Router();

// TODO: Add authentication token
router.get("/subjects", async (req: Request, res: Response) => {
    // console.log('Query: ', req.query);
    // const planId = req.query.planId as string;

    // if (!planId) {
    //     const subjects = await getAllSubjects();
    //     res.status(201).json(subjects);
    //     return;
    // }

    // try { 
    //     const subjects: any = await getSubjectsByPlan(planId);
    //     res.status(201).json(subjects);

    // } catch (error) {
    //     res.status(500).json({ error: (error as Error).message });
    // }
    res.send("Hello World2");

});

router.use("", classRoomsRouter)

export default router;