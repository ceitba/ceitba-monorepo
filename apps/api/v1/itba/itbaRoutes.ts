import express from "express";
import { Request, Response } from "express";
import { getSubjectsByPlan, getAllSubjects } from "./itbagw/subjects";
import classRoomsRouter from "./classrooms/classRooms";
const router = express.Router();

router.use("", classRoomsRouter)

export default router;