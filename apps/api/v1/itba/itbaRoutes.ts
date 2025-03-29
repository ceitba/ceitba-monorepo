import express from "express";
import { Request, Response } from "express";
import { getSubjectsByPlan, getAllSubjects } from "./itbagw/subjects";
import classRoomsRouter from "./classrooms/classrooms";
import careerRouter from "./career/career";
const router = express.Router();

router.use("/classrooms/", classRoomsRouter)
router.use("/career/", careerRouter);

export default router;