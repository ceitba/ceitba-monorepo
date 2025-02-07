import express from "express";
import { Request, Response } from "express";
import proposalsRouter from "./proposals/proposals";

const router = express.Router();

router.use("/proposals", proposalsRouter);


export default router;