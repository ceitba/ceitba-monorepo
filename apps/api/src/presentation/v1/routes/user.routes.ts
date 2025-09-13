import express from 'express';
import { UserContainer } from '@/shared/container/user.container';
import { CreateUserSchema } from '@/shared/validation/user.schemas';
import { validateRequest } from '@/shared/middleware/validateRequest';

function createUserRoutes(): express.Router {
    const router = express.Router();
    const container = UserContainer.getInstance();

    const userController = container.userController;

    // TODO: Add missing routes
    router.get('/', (req, res, next) => userController.getAllUsers(req, res, next));
    router.post('/create',
        validateRequest(CreateUserSchema),
        (req, res, next) => userController.createUser(req, res, next)
    );

    return router;
}

export default createUserRoutes;