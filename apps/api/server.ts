import express, { Request, Response } from "express";
import dotenv from "dotenv";
dotenv.config();
import process from "process";
import itbaRouter from "./v1/itba/itbaRoutes";
import schedulerRouter from "./v1/scheduler/scheduler_routes";

const app = express();

const PORT = process.env.PORT || 3000;
export const ITBA_API_TOKEN = process.env.ITBA_API_TOKEN
export const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!

app.use(express.json());

app.get("/api", (req: Request, res: Response) => {
  res.send("Hello World");
});

app.use('/api/v1/itba', itbaRouter);
app.use('/api/v1/scheduler', schedulerRouter);

app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
});

export default app;
