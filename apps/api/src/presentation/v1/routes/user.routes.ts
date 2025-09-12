import express from 'express';
import { UserContainer } from '@/shared/container/user.container';

function createUserRoutes(): express.Router {
    const router = express.Router();
    const container = UserContainer.getInstance();

    const userController = container.userService;

    // TODO: Add routes


    return router;
}