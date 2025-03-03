import express, { Request, Response } from "express";
import dotenv from "dotenv";
import cors from 'cors';
dotenv.config();
import process from "process";
import cron from "node-cron";
import itbaRouter from "./v1/itba/itbaRoutes";
import appRouter from "./v1/app/appRoutes";
import schedulerRouter from "./v1/scheduler/scheduler_routes";
import minecraftRouter from "./v1/minecraft/whitelist";
import {UpdateCommissions,UpdateSubjects} from "./v1/itba/itbagw/update";
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import userRouter from "./v1/user/user_routes";

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'CEITBA API',
            version: '1.0.0'
        },
        servers:[
          {
            url:"/api/v1"
          }
        ],
        tags: [
          {
              name: "ITBA",
              description: "Endpoints related to ITBA data"
          },
          {
              name: "App",
              description: "Endpoints related to the application"
          },
          {
              name: "Scheduler",
              description: "Endpoints related to scheduling"
          },
          {
              name: "Minecraft",
              description: "Endpoints related to Minecraft"
          },
          {
              name: "User",
              description: "Endpoints related to user management"
          }
      ]
    },
    apis: ['./v1/**/*.ts'] // Adjust paths to match your routes
};

var options = {
  explorer: true
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);



const app = express();

const PORT = process.env.PORT || 3000;
export const ITBA_API_TOKEN = process.env.ITBA_API_TOKEN
export const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec,options));
// Allowing the website to access the API
app.use(cors({
    origin: ['https://ceitba.org.ar'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.get("/api", (req: Request, res: Response) => {
  res.send("Hello World");
});

app.use('/api/v1/itba', itbaRouter);
app.use('/api/v1/scheduler', schedulerRouter);
app.use('/api/v1/minecraft', minecraftRouter);
app.use('/api/v1/app', appRouter);
app.use('/api/v1/user', userRouter);

app.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
});

cron.schedule('0 0,12 * * *', UpdateCommissions);
cron.schedule('0 0,12 * * *', UpdateSubjects);

export default app;
