import express, { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import dotenv from "dotenv";
import cors from 'cors';
import process from "process";
import cron from "node-cron";

dotenv.config();

import createItbaRoutes from "@/presentation/v1/routes/itba.routes";
import { setupSwagger } from "@/docs/swagger-setup";
import { ItbaContainer } from "@/shared/container/itba.container";
import { ApiFactory } from "@/shared/external-apis";
import { ItbaApiServiceImpl } from "@/domain/itba/repositories/itba-api.service.impl";
import createUserRoutes from "@/presentation/v1/routes/user.routes";
// import { UpdateCommissions, UpdateSubjects } from "./v1/itba/itbagw/update";

const app = express();
const PORT = process.env.PORT || 3000;

export const ITBA_API_TOKEN = process.env.ITBA_API_TOKEN!;
export const ITBA_API_BASE_URL = process.env.ITBA_API_BASE_URL!;
export const ITBA_API_TIMEOUT = process.env.ITBA_API_TIMEOUT || '30000';

export const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN!;

function configureExternalServices(): void {

    const itbaApiClient = ApiFactory.createClient('itba-api', {
        baseUrl: ITBA_API_BASE_URL,
        timeout: parseInt(ITBA_API_TIMEOUT),
        defaultHeaders: {
            'Content-Type': 'application/json'
        }
    });

    const itbaApiService = new ItbaApiServiceImpl(ITBA_API_TOKEN, undefined, itbaApiClient);
    
    const container = ItbaContainer.getInstance();
    container.setItbaApiService(itbaApiService);

    console.log('External API services configured successfully');
}

configureExternalServices();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

setupSwagger(app);

app.use(cors({
    origin: [
        'https://ceitba.org.ar',
        'http://localhost:3000',
        'http://localhost:3001'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true
}));

app.get("/api", (req: Request, res: Response) => {
    res.json({ 
        message: "CEITBA API is running", 
        version: "1.0.0",
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
});

app.get("/api/health", (req: Request, res: Response) => {
    res.json({ 
        status: "healthy", 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: "1.0.0"
    });
});

const itbaRouter = createItbaRoutes();
app.use('/api/v1/itba', itbaRouter);
const userRouter = createUserRoutes();
app.use('/api/v1/users', userRouter);

app.use('*', (req: Request, res: Response) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
    });
});

const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    console.error('Unhandled error:', err);
    
    if (err.type === 'entity.parse.failed') {
        res.status(400).json({
            error: 'Invalid JSON in request body',
            details: err.message
        });
        return;
    }
    
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
        timestamp: new Date().toISOString()
    });
};

app.use(errorHandler);

const server = app.listen(PORT, () => {
    console.log(`CEITBA API Server running on port ${PORT}`);
    console.log(`API Documentation available at: http://localhost:${PORT}/api/docs`);
    console.log(`Health check available at: http://localhost:${PORT}/api/health`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

if (process.env.NODE_ENV === 'production' || process.env.ENABLE_CRON === 'true') {
    console.log('Setting up cron jobs...');
    
    cron.schedule('0 0,12 * * *', () => {
        console.log('Running scheduled data updates...');
        // UpdateCommissions();
        // UpdateSubjects();
    });
    
    console.log('Cron jobs configured');
} else {
    console.log('Cron jobs disabled (not in production)');
}

export default app;