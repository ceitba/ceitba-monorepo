import express, { Request, Response } from "express";
import dotenv from "dotenv";
import process from "process";
import itbaRouter from "./v1/itba/itbaRoutes";
dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/api", (req: Request, res: Response) => {
  res.send("Hello World");
});

app.use('/api/v1/itba', itbaRouter);

app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
});

export default app;
