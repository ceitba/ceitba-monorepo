import express from "express";
import { Request, Response } from "express";
import { getSubjectsByPlan, getAllSubjects } from "./itbagw/subjects";
import classRoomsRouter from "./classrooms/classrooms";
const router = express.Router();

router.use("/classrooms/", classRoomsRouter)

export default router;