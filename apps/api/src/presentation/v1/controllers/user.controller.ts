import { Request, Response, NextFunction } from "express";
import { CreateUserDto, UserService } from "@/domain/user";
import { CreateUserRequest } from "@/shared/validation/user.schemas";

export class UserController {
    constructor(private readonly userService: UserService) {}

    async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const createUserRequest = req.body as CreateUserRequest;
            const user = await this.userService.createUser(createUserRequest);
            res.status(201).json(user);
        } catch (error) { 
            next(error);
        }
    }

    async getAllUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const users = await this.userService.getAllUsers();
            res.status(200).json(users);
        } catch (error) {
            next(error);
        }
    }
}